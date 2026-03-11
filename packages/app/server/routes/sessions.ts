import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import type { DbSession } from "../types.js";
import {
  destroyPty,
  destroyAllPtys,
  createPty,
  getPty,
  getTerminalOutput,
  getTerminalOutputCursor,
  resizePty,
  addPtyOutputListener,
  searchTerminalOutput,
} from "../pty-manager.js";

const router = Router();
const SAFE_TEXT_LIMIT = 10_000;

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
  const { name, type = "conversation", workspace_id = null } = req.body;

  const validTypes = ["terminal", "conversation"];
  if (!validTypes.includes(type)) {
    return res
      .status(400)
      .json({ error: "Invalid session type. Must be 'terminal' or 'conversation'." });
  }

  const id = nanoid(12);
  const sessionName = name || (type === "terminal" ? "Terminal" : "Conversation");

  db.prepare("INSERT INTO sessions (id, name, type, shell, workspace_id) VALUES (?, ?, ?, ?, ?)").run(
    id,
    sessionName,
    type,
    null,
    workspace_id
  );

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);

  const io = req.app.get("io");
  if (io) io.emit("session_list_changed");

  res.status(201).json(session);
});

// Update session
router.patch("/api/sessions/:id", (req, res) => {
  const { name, workspace_id, archived } = req.body;
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (name) {
    db.prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, req.params.id);
  }

  if (workspace_id !== undefined) {
    db.prepare("UPDATE sessions SET workspace_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(workspace_id, req.params.id);
  }

  if (archived !== undefined) {
    db.prepare("UPDATE sessions SET archived = ?, updated_at = datetime('now') WHERE id = ?")
      .run(archived ? 1 : 0, req.params.id);
    // Free PTY resources when archiving a terminal session
    if (archived && session.type === "terminal") {
      destroyPty(req.params.id);
    }
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
  const since = Number(sinceRaw);
  const limit = Number(limitRaw);

  const events = getTerminalOutput(req.params.sessionId, {
    since: Number.isFinite(since) ? since : 0,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  const cursor = getTerminalOutputCursor(req.params.sessionId);
  res.json({
    sessionId: req.params.sessionId,
    since: Number.isFinite(since) ? since : 0,
    cursor,
    events,
  });
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

export default router;
