import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbSession } from "../types.js";
import { stripAnsi } from "../types.js";
import { normalizeRole, VALID_FORMATS } from "../constants.js";
import { resolveMentions } from "./agent-v2.js";
import { bus } from "../events/bus.js";

const VALID_STATUSES = ["pending", "streaming", "complete"] as const;

const router = Router();

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
}

function ensureConversationSession(sessionId: string, res: any): DbSession | null {
  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  if (session.type !== "conversation") {
    res.status(409).json({
      error: "Only conversation sessions can access messages",
    });
    return null;
  }
  return session;
}

// List messages for a conversation session
router.get("/api/sessions/:sessionId/messages", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const { since, limit = "100", thread_id, starred } = req.query;
  let query: string;
  const params: any[] = [req.params.sessionId];

  if (thread_id) {
    query = "SELECT m.* FROM messages m WHERE m.session_id = ? AND m.thread_id = ?";
    params.push(thread_id as string);
  } else if (starred === "true") {
    query = `SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) AS reply_count
             FROM messages m WHERE m.session_id = ? AND m.starred = 1 AND m.thread_id IS NULL`;
  } else {
    query = `SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) AS reply_count
             FROM messages m WHERE m.session_id = ? AND m.thread_id IS NULL`;
  }

  if (since) {
    query += " AND m.created_at > ?";
    params.push(since as string);
  }

  query += " ORDER BY m.created_at ASC LIMIT ?";
  const parsedLimit = Math.max(1, Math.min(parseInt(limit as string, 10) || 100, 1000));
  params.push(parsedLimit);

  const messages = db.prepare(query).all(...params).map((m: any) => ({
    ...m,
    metadata: m.metadata ? JSON.parse(m.metadata) : null,
    annotations: m.annotations ? JSON.parse(m.annotations) : null,
  }));
  res.json(messages);
});

// Create a message
router.post("/api/sessions/:sessionId/messages", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const {
    role = "agent",
    content = "",
    format = "markdown",
    status = "complete",
    metadata = null,
    message_type,
    sender_type,
    sender_name,
    sender_cwd,
    sender_persona,
    sender_terminal_id,
    thread_id,
  } = req.body;

  const normalisedRole = normalizeRole(role);
  if (!normalisedRole) {
    return res.status(400).json({ error: "Invalid role" });
  }

  // Validate sender_terminal_id if provided — prevents identity spoofing
  let resolvedSenderName = sender_name || null;
  if (sender_terminal_id) {
    const terminal = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sender_terminal_id);
    if (!terminal) {
      return res.status(400).json({ error: "Invalid sender_terminal_id: terminal session not found" });
    }
    // Look up user-set display name for this terminal
    const displayName = db.prepare("SELECT display_name FROM terminal_display_names WHERE terminal_id = ?").get(sender_terminal_id) as any;
    if (displayName) {
      resolvedSenderName = displayName.display_name;
    }
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (typeof content !== "string" || content.length > 100_000) {
    return res.status(400).json({ error: "Content too large" });
  }
  if (typeof format !== "string" || !format.trim()) {
    return res.status(400).json({ error: "Invalid format" });
  }
  if (!VALID_FORMATS.has(format)) {
    return res.status(400).json({ error: "Invalid format" });
  }

  // Ephemeral status messages (thinking/idle heartbeats) — emit as transient
  // Socket.IO events but don't persist to DB. They pollute conversation history.
  if (normalisedRole === "system" && format === "json") {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed?.status === "string" && typeof parsed?.from === "string") {
        const io = req.app.get("io");
        if (io) {
          io.to(req.params.sessionId).emit("agent_status", {
            sessionId: req.params.sessionId,
            from: parsed.from,
            status: parsed.status,
            message: parsed.message,
          });
        }
        return res.status(200).json({ id: null, transient: true, status: parsed.status });
      }
    } catch {
      // Not valid JSON — continue with normal persistence
    }
  }

  const id = nanoid(12);

  // Strip ANSI escapes so terminal sequences don't leak into conversation messages
  const sanitisedContent = (format === "text" || format === "plaintext")
    ? stripAnsi(content)
    : content;

  const resolvedSenderType = sender_type || (normalisedRole === "human" ? "human" : normalisedRole === "system" ? "system" : "unknown");

  const resolvedMessageType = message_type || "text";

  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, format, status, metadata, message_type, sender_type, sender_name, sender_cwd, sender_persona, sender_terminal_id, thread_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, req.params.sessionId, normalisedRole, sanitisedContent, format, status,
    metadata ? JSON.stringify(metadata) : null,
    resolvedMessageType,
    resolvedSenderType, resolvedSenderName, sender_cwd || null, sender_persona || null, sender_terminal_id || null, thread_id || null,
  );

  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(
    req.params.sessionId
  );

  // --- ANTchat room linking + junction tables ---
  if (metadata?.source === "antchat" && metadata?.room_name) {
    const room = db.prepare(
      "SELECT id FROM antchat_rooms WHERE name = ? AND status = 'active'"
    ).get(metadata.room_name) as { id: string } | undefined;
    if (room) {
      db.prepare("UPDATE messages SET antchat_room_id = ? WHERE id = ?").run(room.id, id);

      // Populate message_terminal_tags from @mentions in content
      if (sender_terminal_id) {
        const mentionPattern = /@(\S+)/g;
        let match;
        const insertTag = db.prepare(
          "INSERT OR IGNORE INTO message_terminal_tags (message_id, terminal_session_id) VALUES (?, ?)"
        );
        while ((match = mentionPattern.exec(sanitisedContent)) !== null) {
          const mentionHandle = match[1];
          // Resolve handle to a participant's terminal session ID
          const participant = db.prepare(
            "SELECT terminal_session_id FROM antchat_participants WHERE room_id = ? AND agent_name = ? COLLATE NOCASE"
          ).get(room.id, mentionHandle) as { terminal_session_id: string } | undefined;
          if (participant) {
            insertTag.run(id, participant.terminal_session_id);
          }
        }
      }

      // Populate message_context_files from #shortname or path references
      const shortNamePattern = /#(\S+)/g;
      let cfMatch;
      const insertCf = db.prepare(
        "INSERT OR IGNORE INTO message_context_files (message_id, context_file_id) VALUES (?, ?)"
      );
      while ((cfMatch = shortNamePattern.exec(sanitisedContent)) !== null) {
        const ref = cfMatch[1];
        // Try matching by short_name first, then by file_path suffix
        const cf = db.prepare(
          "SELECT id FROM antchat_context_files WHERE room_id = ? AND (short_name = ? COLLATE NOCASE OR file_path LIKE '%' || ?)"
        ).get(room.id, ref, ref) as { id: string } | undefined;
        if (cf) {
          insertCf.run(id, cf.id);
        }
      }
    }
  }

  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
  if (message.metadata) message.metadata = JSON.parse(message.metadata);

  // Notify all in-process subscribers (Chair, message-bridge, etc.) immediately.
  bus.emit("message:new", {
    sessionId: req.params.sessionId,
    id: message.id,
    role: message.role,
    content: message.content ?? "",
    sender_name: message.sender_name,
    sender_type: message.sender_type,
    created_at: message.created_at,
  });

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_created", message);
    if (thread_id) {
      io.to(req.params.sessionId).emit("thread_reply", { threadId: thread_id, message });
    }
  }

  // --- Mention resolution → task creation pipeline ---
  // Only create tasks from human messages without existing protocol metadata.
  // Agent-to-agent @mentions are conversational, not task assignments.
  // Protocol messages (with metadata.type) handle their own semantics.
  const shouldCreateTasks = normalisedRole !== "system"
    && resolvedSenderType === "human"
    && !metadata?.type;
  if (sanitisedContent && shouldCreateTasks) {
    try {
      const mentions = resolveMentions(sanitisedContent, req.params.sessionId);
      if (mentions.length > 0) {
        // Extract task text per mention: split on @mention boundaries
        const mentionTasks = extractTasksPerMention(sanitisedContent, mentions);

        for (const { mention, taskText } of mentionTasks) {
          const taskId = nanoid(12);
          const payload = JSON.stringify({
            task: taskText,
            from: { name: sender_name || "Unknown", type: resolvedSenderType },
            full_message: sanitisedContent.length > 500 ? sanitisedContent.slice(0, 500) + "..." : sanitisedContent,
          });

          db.prepare(`
            INSERT INTO coordination_events (id, session_id, event_type, agent_id, target_agent_id, payload, status, source, source_message_id, source_session_id, expires_at)
            VALUES (?, ?, 'task_available', ?, ?, ?, 'pending', 'mention', ?, ?, ?)
          `).run(
            taskId,
            req.params.sessionId,
            null, // agent_id (creator) — could be the sender
            mention.agent_id,
            payload,
            id, // source_message_id
            req.params.sessionId,
            new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h expiry
          );

          // Push notification to online agents via Socket.IO
          if (io) {
            io.emit("agent_notification", {
              type: "mention",
              task_id: taskId,
              target_agent_id: mention.agent_id,
              session_id: req.params.sessionId,
              message_id: id,
              from: { name: sender_name || "Unknown", type: resolvedSenderType },
              extracted_task: taskText,
              handle: mention.handle,
              created_at: new Date().toISOString(),
            });
          }
        }

        // Post system message summarising task assignments
        if (mentionTasks.length > 0) {
          const summaryParts = mentionTasks.map(({ mention, taskText }) =>
            `@${mention.handle}: ${taskText.length > 80 ? taskText.slice(0, 80) + "..." : taskText}`
          );
          const summaryContent = mentionTasks.length === 1
            ? `Task assigned to ${summaryParts[0]}`
            : `${mentionTasks.length} tasks created:\n${summaryParts.map((s) => `\u2022 ${s}`).join("\n")}`;

          const sysMsgId = nanoid(12);
          db.prepare(`
            INSERT INTO messages (id, session_id, role, content, format, sender_type, sender_name, message_type, metadata)
            VALUES (?, ?, 'system', ?, 'markdown', 'system', 'ANT', 'agent_action', ?)
          `).run(
            sysMsgId, req.params.sessionId, summaryContent,
            JSON.stringify({ type: "assignment", mentions: mentionTasks.map(({ mention }) => ({ agent_id: mention.agent_id, handle: mention.handle })) }),
          );

          if (io) {
            const sysMsg = db.prepare("SELECT * FROM messages WHERE id = ?").get(sysMsgId) as any;
            if (sysMsg) {
              if (sysMsg.metadata) sysMsg.metadata = JSON.parse(sysMsg.metadata);
              io.to(req.params.sessionId).emit("message_created", sysMsg);
            }
          }
        }
      }
    } catch {
      // Non-fatal — mention resolution shouldn't break message creation
    }
  }

  res.status(201).json(message);
});

// Helper: extract task text per mention from a multi-mention message
function extractTasksPerMention(
  content: string,
  mentions: Array<{ agent_id: string; handle: string; display_name: string; matched: string; in_conversation: boolean }>
): Array<{ mention: typeof mentions[0]; taskText: string }> {
  const results: Array<{ mention: typeof mentions[0]; taskText: string }> = [];

  if (mentions.length === 1) {
    // Single mention: task is everything after the @mention
    const pattern = new RegExp(`@${mentions[0].matched}\\s*`, "i");
    const taskText = content.replace(pattern, "").trim();
    if (taskText) results.push({ mention: mentions[0], taskText });
    return results;
  }

  // Multiple mentions: split on @mention boundaries
  // Find positions of each mention
  const positions: Array<{ mention: typeof mentions[0]; start: number; end: number }> = [];
  for (const mention of mentions) {
    const regex = new RegExp(`@${mention.matched}`, "i");
    const match = regex.exec(content);
    if (match) {
      positions.push({ mention, start: match.index, end: match.index + match[0].length });
    }
  }

  // Sort by position
  positions.sort((a, b) => a.start - b.start);

  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];
    const nextStart = i + 1 < positions.length ? positions[i + 1].start : content.length;
    const taskText = content.slice(current.end, nextStart).trim();
    if (taskText) results.push({ mention: current.mention, taskText });
  }

  return results;
}

// Update message (for streaming)
router.patch("/api/sessions/:sessionId/messages/:id", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const message = db
    .prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?")
    .get(req.params.id, req.params.sessionId);

  if (!message) return res.status(404).json({ error: "Message not found" });

  const { content, status, metadata } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (
    content !== undefined &&
    (typeof content !== "string" || content.length > 100_000)
  ) {
    return res.status(400).json({ error: "Content too large" });
  }

  const updates: string[] = [];
  const values: any[] = [];
  if (content !== undefined) { updates.push("content = ?"); values.push(content); }
  if (status !== undefined) { updates.push("status = ?"); values.push(status); }
  if (metadata !== undefined) { updates.push("metadata = ?"); values.push(JSON.stringify(metadata)); }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE messages SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id) as any;
  if (updated.metadata) updated.metadata = JSON.parse(updated.metadata);
  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_updated", updated);
  }

  res.json(updated);
});

// Delete message (cascade: delete thread replies first)
router.delete("/api/sessions/:sessionId/messages/:id", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  db.prepare("DELETE FROM messages WHERE thread_id = ? AND session_id = ?")
    .run(req.params.id, req.params.sessionId);

  const result = db.prepare("DELETE FROM messages WHERE id = ? AND session_id = ?")
    .run(req.params.id, req.params.sessionId);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Message not found" });
  }

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_deleted", {
      id: req.params.id,
      sessionId: req.params.sessionId,
    });
  }

  res.json({ deleted: true });
});

// Get thread (parent + replies)
router.get("/api/sessions/:sessionId/messages/:msgId/thread", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const parent = db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?")
    .get(req.params.msgId, req.params.sessionId) as any;

  if (!parent) return res.status(404).json({ error: "Message not found" });

  const replies = db.prepare(
    "SELECT * FROM messages WHERE thread_id = ? AND session_id = ? ORDER BY created_at ASC"
  ).all(req.params.msgId, req.params.sessionId).map((m: any) => ({
    ...m,
    metadata: m.metadata ? JSON.parse(m.metadata) : null,
    annotations: m.annotations ? JSON.parse(m.annotations) : null,
  }));

  if (parent.metadata) parent.metadata = JSON.parse(parent.metadata);
  if (parent.annotations) parent.annotations = JSON.parse(parent.annotations);

  res.json({ parent, replies });
});

// Global search across sessions and messages
router.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  const workspaceId = req.query.workspace_id as string | undefined;
  const includeArchived = req.query.include_archived === "true";
  const limitRaw = Number(req.query.limit) || 50;
  const limit = Math.max(1, Math.min(limitRaw, 200));
  const escaped = `%${q}%`;
  const archivedClause = includeArchived ? "" : " AND archived = 0";

  // Match sessions by name
  let sessionQuery = `SELECT id, name, type, workspace_id FROM sessions WHERE 1=1${archivedClause} AND name LIKE ?`;
  const sessionParams: any[] = [escaped];
  if (workspaceId) {
    sessionQuery += " AND workspace_id = ?";
    sessionParams.push(workspaceId);
  }
  sessionQuery += " ORDER BY updated_at DESC LIMIT ?";
  sessionParams.push(limit);

  const sessions = db.prepare(sessionQuery).all(...sessionParams);

  // Match messages by content
  const msgArchivedClause = includeArchived ? "" : " AND s.archived = 0";
  let messageQuery = `
    SELECT m.id, m.session_id, s.name AS session_name, s.type AS session_type,
           m.role, m.content, m.created_at
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    WHERE 1=1${msgArchivedClause} AND m.content LIKE ?
  `;
  const messageParams: any[] = [escaped];
  if (workspaceId) {
    messageQuery += " AND s.workspace_id = ?";
    messageParams.push(workspaceId);
  }
  messageQuery += " ORDER BY m.created_at DESC LIMIT ?";
  messageParams.push(limit);

  const rawMessages = db.prepare(messageQuery).all(...messageParams) as any[];

  // Create 100-char snippet around match
  const messages = rawMessages.map((m) => {
    const idx = m.content.toLowerCase().indexOf(q.toLowerCase());
    const start = Math.max(0, idx - 50);
    const end = Math.min(m.content.length, idx + q.length + 50);
    const snippet =
      (start > 0 ? "..." : "") +
      m.content.slice(start, end) +
      (end < m.content.length ? "..." : "");
    return {
      id: m.id,
      session_id: m.session_id,
      session_name: m.session_name,
      session_type: m.session_type,
      role: m.role,
      content_snippet: snippet,
      created_at: m.created_at,
    };
  });

  res.json({ sessions, messages });
});

// Set or update terminal display name
router.post("/api/terminals/:terminalId/display-name", (req, res) => {
  const { display_name } = req.body;
  if (!display_name || typeof display_name !== "string" || !display_name.trim()) {
    return res.status(400).json({ error: "display_name required and must be non-empty string" });
  }

  const terminal = db.prepare("SELECT id FROM sessions WHERE id = ?").get(req.params.terminalId);
  if (!terminal) {
    return res.status(404).json({ error: "Terminal not found" });
  }

  db.prepare(
    `INSERT INTO terminal_display_names (terminal_id, display_name, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(terminal_id) DO UPDATE SET display_name = excluded.display_name, updated_at = datetime('now')`
  ).run(req.params.terminalId, display_name.trim());

  res.json({ ok: true, terminalId: req.params.terminalId, display_name: display_name.trim() });
});

// Get terminal display name
router.get("/api/terminals/:terminalId/display-name", (req, res) => {
  const displayName = db.prepare("SELECT display_name FROM terminal_display_names WHERE terminal_id = ?").get(req.params.terminalId) as any;
  if (!displayName) {
    return res.status(404).json({ error: "No display name set for this terminal" });
  }
  res.json({ terminalId: req.params.terminalId, display_name: displayName.display_name });
});

export default router;
