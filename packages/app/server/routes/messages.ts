import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbSession } from "../types.js";
import { stripAnsi } from "../types.js";
import { normalizeRole, VALID_FORMATS } from "../constants.js";

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
    sender_type,
    sender_name,
    sender_cwd,
    sender_persona,
    thread_id,
  } = req.body;

  const normalisedRole = normalizeRole(role);
  if (!normalisedRole) {
    return res.status(400).json({ error: "Invalid role" });
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

  const id = nanoid(12);

  // Strip ANSI escapes so terminal sequences don't leak into conversation messages
  const sanitisedContent = (format === "text" || format === "plaintext")
    ? stripAnsi(content)
    : content;

  const resolvedSenderType = sender_type || (normalisedRole === "human" ? "human" : normalisedRole === "system" ? "system" : "unknown");

  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, format, status, metadata, sender_type, sender_name, sender_cwd, sender_persona, thread_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, req.params.sessionId, normalisedRole, sanitisedContent, format, status,
    metadata ? JSON.stringify(metadata) : null,
    resolvedSenderType, sender_name || null, sender_cwd || null, sender_persona || null, thread_id || null,
  );

  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(
    req.params.sessionId
  );

  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
  if (message.metadata) message.metadata = JSON.parse(message.metadata);

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_created", message);
    if (thread_id) {
      io.to(req.params.sessionId).emit("thread_reply", { threadId: thread_id, message });
    }
  }

  res.status(201).json(message);
});

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

export default router;
