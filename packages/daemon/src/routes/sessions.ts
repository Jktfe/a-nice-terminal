import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { error as logError } from "../logger.js";
import type { DbSession } from "../types.js";
import {
  destroyPty,
  destroyAllPtys,
  createPty,
  getPty,
  getHeadless,
  getTerminalOutput,
  getTerminalOutputCursor,
  resizePty,
  addPtyOutputListener,
  searchTerminalOutput,
} from "../pty-manager.js";
import { SAFE_TEXT_LIMIT } from "../constants.js";

const router = Router();

function parseHourMinute(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d{1,2})(?::([0-5]?\d)(?::([0-5]?\d))?)?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const second = match[3] ? Number(match[3]) : 0;

  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 3600 + minute * 60 + second;
}

// List sessions
router.get("/api/sessions", (req, res) => {
  const includeArchived = req.query.include_archived === "true";
  const query = includeArchived
    ? "SELECT * FROM sessions ORDER BY updated_at DESC"
    : "SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC";
  const sessions = db.prepare(query).all();
  res.json(sessions);
});

// Kill all terminal sessions (nuclear option) — must be before :id routes
router.delete("/api/sessions/terminals/all", (_req, res) => {
  const count = destroyAllPtys();
  res.json({ destroyed: count });
});

// Check if a session has any content (terminal output or messages)
router.get("/api/sessions/:id/has-content", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  let hasContent = false;
  if (session.type === "terminal") {
    const row = db
      .prepare("SELECT COUNT(*) as c FROM terminal_output_events WHERE session_id = ? LIMIT 1")
      .get(req.params.id) as { c: number };
    hasContent = row.c > 0;
  } else {
    const row = db
      .prepare("SELECT COUNT(*) as c FROM messages WHERE session_id = ? LIMIT 1")
      .get(req.params.id) as { c: number };
    hasContent = row.c > 0;
  }
  res.json({ hasContent });
});

// Get single session
router.get("/api/sessions/:id", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id) as DbSession | undefined;

  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// Create session
router.post("/api/sessions", (req, res) => {
  const { name, type = "conversation", workspace_id = null, cwd = null } = req.body;

  const validTypes = ["terminal", "conversation", "unified"];
  if (!validTypes.includes(type)) {
    return res
      .status(400)
      .json({ error: "Invalid session type. Must be 'terminal', 'conversation', or 'unified'." });
  }

  const defaultBase = type === "terminal" ? "Terminal" : type === "unified" ? "Session" : "Conversation";
  let sessionName: string;

  if (name) {
    // Check for duplicate active name (case-insensitive)
    const clash = db.prepare(
      "SELECT id FROM sessions WHERE name = ? COLLATE NOCASE AND archived = 0"
    ).get(name);
    if (clash) {
      return res.status(409).json({ error: `A session named '${name}' already exists` });
    }
    sessionName = name;
  } else {
    // Auto-increment default names: "Terminal", "Terminal 2", "Terminal 3", ...
    const existing = db.prepare(
      "SELECT name FROM sessions WHERE archived = 0 AND (name = ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE)"
    ).all(defaultBase, `${defaultBase} %`) as { name: string }[];

    const takenNumbers = new Set<number>();
    takenNumbers.add(0); // placeholder
    for (const row of existing) {
      if (row.name.toLowerCase() === defaultBase.toLowerCase()) {
        takenNumbers.add(1);
      } else {
        const match = row.name.match(new RegExp(`^${defaultBase}\\s+(\\d+)$`, "i"));
        if (match) takenNumbers.add(parseInt(match[1], 10));
      }
    }

    if (!takenNumbers.has(1)) {
      sessionName = defaultBase;
    } else {
      let n = 2;
      while (takenNumbers.has(n)) n++;
      sessionName = `${defaultBase} ${n}`;
    }
  }

  const id = nanoid(12);
  const resolvedCwd = cwd || process.env.ANT_ROOT_DIR || null;

  db.prepare("INSERT INTO sessions (id, name, type, shell, cwd, workspace_id) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    sessionName,
    type,
    null,
    resolvedCwd,
    workspace_id
  );

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as DbSession;

  // For unified sessions: optionally auto-create and attach a terminal
  let terminalId: string | null = null;
  if (type === "unified" && req.body.terminal) {
    const termId = nanoid(12);
    const termName = `${sessionName} (terminal)`;
    const termCwd = resolvedCwd || process.env.ANT_ROOT_DIR || null;
    db.prepare("INSERT INTO sessions (id, name, type, shell, cwd, workspace_id) VALUES (?, ?, 'terminal', ?, ?, ?)")
      .run(termId, termName, null, termCwd, workspace_id);
    db.prepare("INSERT INTO session_terminals (session_id, terminal_session_id) VALUES (?, ?)")
      .run(id, termId);
    terminalId = termId;
  }

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.status(201).json({ ...session, terminal_id: terminalId });
});

// Update session
router.patch("/api/sessions/:id", (req, res) => {
  const { name, workspace_id, archived } = req.body;
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (name) {
    const clash = db.prepare(
      "SELECT id FROM sessions WHERE name = ? COLLATE NOCASE AND archived = 0 AND id != ?"
    ).get(name, req.params.id);
    if (clash) {
      return res.status(409).json({ error: `A session named '${name}' already exists` });
    }
    db.prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, req.params.id);
  }

  if (workspace_id !== undefined) {
    db.prepare("UPDATE sessions SET workspace_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(workspace_id, req.params.id);
  }

  if (archived !== undefined) {
    if (archived) {
      // Archiving: append timestamp suffix to free the name for reuse
      const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
      const archivedName = `${session.name} (archived ${timestamp})`;
      db.prepare("UPDATE sessions SET archived = 1, name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(archivedName, req.params.id);
      // Free PTY resources when archiving a terminal session
      if (session.type === "terminal") {
        destroyPty(req.params.id);
      }
    } else {
      // Restoring: strip archive suffix if original name is available
      const archiveSuffixPattern = / \(archived \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/;
      let restoredName = session.name;
      const match = session.name.match(archiveSuffixPattern);
      if (match) {
        const originalName = session.name.replace(archiveSuffixPattern, "");
        const clash = db.prepare(
          "SELECT id FROM sessions WHERE name = ? COLLATE NOCASE AND archived = 0 AND id != ?"
        ).get(originalName, req.params.id);
        if (!clash) {
          restoredName = originalName;
        }
      }
      db.prepare("UPDATE sessions SET archived = 0, name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(restoredName, req.params.id);
    }
  }

  if (req.body.ttl_minutes !== undefined) {
    const ttl = req.body.ttl_minutes;
    // null = use global default, 0 = always on, positive integer = custom minutes
    if (ttl !== null && (typeof ttl !== "number" || ttl < 0 || !Number.isFinite(ttl))) {
      return res.status(400).json({ error: "ttl_minutes must be null, 0, or a positive number" });
    }
    db.prepare("UPDATE sessions SET ttl_minutes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(ttl, req.params.id);
  }

  if (req.body.retain_history !== undefined) {
    db.prepare("UPDATE sessions SET retain_history = ?, updated_at = datetime('now') WHERE id = ?")
      .run(req.body.retain_history ? 1 : 0, req.params.id);
  }

  const updated = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id);

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.json(updated);
});

// Delete session
router.delete("/api/sessions/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM sessions WHERE id = ?")
    .run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Clean up PTY process if this was a terminal session
  destroyPty(req.params.id);
  db.prepare("DELETE FROM terminal_output_events WHERE session_id = ?").run(req.params.id);

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.json({ deleted: true });
});

// Send terminal input
router.post("/api/sessions/:sessionId/terminal/input", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res.status(409).json({ error: "Only terminal sessions can accept terminal input" });
  }

  const { data } = req.body;
  if (typeof data !== "string" || data.length > SAFE_TEXT_LIMIT) {
    return res.status(400).json({ error: "Invalid or too large input" });
  }

  try {
    let ptyProcess = getPty(req.params.sessionId);
    const io = req.app.get("io");

    if (!ptyProcess) {
      ptyProcess = createPty(req.params.sessionId, session.shell, session.cwd);
      if (io) {
        const sid = req.params.sessionId;
        const emitter = (chunk: string) => {
          io.to(sid).emit("terminal_output", { sessionId: sid, data: chunk });
        };
        addPtyOutputListener(sid, emitter);
      }
    }

    try {
      ptyProcess.write(data);
    } catch (writeErr) {
      destroyPty(req.params.sessionId);
      ptyProcess = createPty(req.params.sessionId, session.shell, session.cwd);
      if (io) {
        const sid = req.params.sessionId;
        const emitter = (chunk: string) => {
          io.to(sid).emit("terminal_output", { sessionId: sid, data: chunk });
        };
        addPtyOutputListener(sid, emitter);
      }
      ptyProcess.write(data);
    }
    res.json({ accepted: true, cursor: getTerminalOutputCursor(req.params.sessionId) });
  } catch (err) {
    res.status(503).json({
      error: "Terminal input failed",
      details: "Terminal process was not accepting input; check session health and retry.",
    });
  }
});

// Resize terminal
router.post("/api/sessions/:sessionId/terminal/resize", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res
      .status(409)
      .json({ error: "Only terminal sessions can be resized" });
  }

  const { cols, rows } = req.body;
  const nextCols = Number(cols);
  const nextRows = Number(rows);
  if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
    return res.status(400).json({ error: "Invalid terminal size" });
  }

  const safeCols = Math.max(1, Math.min(Math.trunc(nextCols), 500));
  const safeRows = Math.max(1, Math.min(Math.trunc(nextRows), 200));
  resizePty(req.params.sessionId, safeCols, safeRows);
  res.json({ cols: safeCols, rows: safeRows });
});

// Read terminal output stream
router.get("/api/sessions/:sessionId/terminal/output", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res.status(409).json({ error: "Only terminal sessions have terminal output" });
  }

  const sinceRaw = req.query.since;
  const limitRaw = req.query.limit;
  const since = sinceRaw !== undefined ? Number(sinceRaw) : undefined;
  const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;

  const events = getTerminalOutput(req.params.sessionId, {
    since: since !== undefined && Number.isFinite(since) ? since : undefined,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
  });
  const cursor = getTerminalOutputCursor(req.params.sessionId);
  res.json({
    sessionId: req.params.sessionId,
    since: events.length > 0 ? events[0].index : 0,
    cursor,
    events,
  });
});

// GET /api/sessions/:id/terminal/state
// Returns a full terminal snapshot (grid + scrollback) and cursor position.
router.get("/api/sessions/:sessionId/terminal/state", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as DbSession | undefined;

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res.status(409).json({ error: "Only terminal sessions have a state snapshot" });
  }

  const format = req.query.format === "ansi" ? "ansi" : "plain";

  try {
    const headless = getHeadless(req.params.sessionId);
    if (!headless) {
      return res.status(503).json({
        error: "Terminal not attached",
        details: "No headless terminal mirror is active. Join the session via WebSocket or send input to re-attach.",
      });
    }

    if (format === "ansi") {
      // Serialise full state (scrollback + screen + cursor) for client restore
      const state = headless.serializeState();
      const cursor = headless.getCursor();
      return res.json({
        sessionId: req.params.sessionId,
        format,
        state,
        cursor,
      });
    }
    // Plain text: return screen lines
    const lines = headless.getScreenLines();
    const cursor = headless.getCursor();
    return res.json({
      sessionId: req.params.sessionId,
      format,
      state: lines.join("\n"),
      cursor,
    });
  } catch (err: any) {
    logError("sessions", `Failed to get terminal state for ${req.params.sessionId}`, err);
    res.status(500).json({ error: "Failed to capture terminal state" });
  }
});

// POST /api/sessions/:id/presence
// Broadcast agent presence/state changes
router.post("/api/sessions/:sessionId/presence", (req, res) => {
  const { state, agentId = "agent" } = req.body;
  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("agent_state_update", {
      sessionId: req.params.sessionId,
      agentId,
      state,
      lastUpdated: new Date().toISOString(),
    });
  }
  res.json({ success: true });
});

router.get("/api/sessions/:sessionId/terminal/search", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res.status(409).json({ error: "Only terminal sessions have terminal output" });
  }

  const rawQuery = String(req.query.q || "").trim();
  const rawStart = String(req.query.start || req.query.from || "").trim();
  const rawEnd = String(req.query.end || req.query.to || "").trim();
  const rawPad = Number(req.query.pad);
  const limitRaw = req.query.limit;
  const limit = Number(limitRaw);

  const hasText = Boolean(rawQuery.length > 0);
  const hasStart = Boolean(rawStart.length > 0);
  const hasEnd = Boolean(rawEnd.length > 0);

  if (!hasText && !(hasStart && hasEnd)) {
    return res.status(400).json({ error: "Provide q, or both start and end." });
  }

  if (hasStart !== hasEnd) {
    return res.status(400).json({ error: "Both start and end are required when filtering by time." });
  }

  const timeStart = hasStart ? parseHourMinute(rawStart) : null;
  const timeEnd = hasEnd ? parseHourMinute(rawEnd) : null;
  if (hasStart && (timeStart === null || timeEnd === null)) {
    return res.status(400).json({ error: "Invalid time format. Use HH, HH:mm, or HH:mm:ss" });
  }

  const normalizedPad = Number.isFinite(rawPad)
    ? Math.max(0, Math.min(Math.floor(rawPad), 120))
    : 15;

  const events = searchTerminalOutput(
    req.params.sessionId,
    hasText ? rawQuery : undefined,
    {
      limit: Number.isFinite(limit) ? limit : undefined,
      start: timeStart ?? undefined,
      end: timeEnd ?? undefined,
      padMinutes: normalizedPad,
    },
  );

  res.json({
    sessionId: req.params.sessionId,
    q: rawQuery || undefined,
    start: rawStart || undefined,
    end: rawEnd || undefined,
    padMinutes: normalizedPad,
    events,
  });
});

// ─── Command blocks (capture pipeline) ───────────────────────────────────────

// GET /api/sessions/:sessionId/commands
// Returns structured command events for TerminalDashboard.
// ?limit=N  (default 100, max 500)
// ?since=<ISO>  — only events started_at > since (for incremental updates)
router.get("/api/sessions/:sessionId/commands", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res.status(409).json({ error: "Only terminal sessions have command events" });
  }

  const rawLimit = Number(req.query.limit);
  const limit = rawLimit > 0 && rawLimit <= 500 ? rawLimit : 100;
  const since = String(req.query.since || "").trim();

  let rows: unknown[];
  if (since) {
    rows = db
      .prepare(
        `SELECT id, session_id, command, exit_code, output, started_at, completed_at,
                duration_ms, cwd, detection_method
         FROM command_events
         WHERE session_id = ? AND started_at > ?
         ORDER BY started_at ASC
         LIMIT ?`
      )
      .all(req.params.sessionId, since, limit);
  } else {
    rows = db
      .prepare(
        `SELECT id, session_id, command, exit_code, output, started_at, completed_at,
                duration_ms, cwd, detection_method
         FROM command_events
         WHERE session_id = ?
         ORDER BY started_at ASC
         LIMIT ?`
      )
      .all(req.params.sessionId, limit);
  }

  res.json(rows);
});

// GET /api/capture/search?q=<text>&session=<id>&limit=N
// Full-text search across all captured command output via FTS5.
router.get("/api/capture/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q is required" });

  const sessionId = String(req.query.session || "").trim();
  if (!sessionId) return res.status(400).json({ error: "session is required" });

  const rawLimit = Number(req.query.limit);
  const limit = rawLimit > 0 && rawLimit <= 200 ? rawLimit : 50;

  // Wrap the query in double-quotes so FTS5 treats it as a literal phrase
  // rather than interpreting operators like * NOT OR and column filters.
  const safeQ = `"${q.replace(/"/g, '""')}"`;

  const rows = db
    .prepare(
      `SELECT ce.id, ce.session_id, ce.command, ce.cwd, ce.exit_code, ce.started_at,
              snippet(command_events_fts, 2, '<mark>', '</mark>', '…', 16) AS output_snippet
       FROM command_events_fts
       JOIN command_events ce ON ce.rowid = command_events_fts.rowid
       WHERE command_events_fts MATCH ? AND ce.session_id = ?
       ORDER BY ce.started_at DESC
       LIMIT ?`
    )
    .all(safeQ, sessionId, limit);

  res.json(rows);
});

export default router;
