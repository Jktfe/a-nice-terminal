import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import {
  destroyPty,
  createPty,
  getPty,
  getTerminalOutput,
  getTerminalOutputCursor,
  resizePty,
} from "../pty-manager.js";

const router = Router();
const SAFE_TEXT_LIMIT = 10_000;

// List sessions
router.get("/api/sessions", (_req, res) => {
  const sessions = db
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
    .all();
  res.json(sessions);
});

// Get single session
router.get("/api/sessions/:id", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id);

  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// Create session
router.post("/api/sessions", (req, res) => {
  const { name, type = "conversation" } = req.body;

  const validTypes = ["terminal", "conversation"];
  if (!validTypes.includes(type)) {
    return res
      .status(400)
      .json({ error: "Invalid session type. Must be 'terminal' or 'conversation'." });
  }

  const id = nanoid(12);
  const sessionName = name || (type === "terminal" ? "Terminal" : "Conversation");

  db.prepare("INSERT INTO sessions (id, name, type, shell) VALUES (?, ?, ?, ?)").run(
    id,
    sessionName,
    type,
    null
  );

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  res.status(201).json(session);
});

// Update session
router.patch("/api/sessions/:id", (req, res) => {
  const { name } = req.body;
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (name) {
    db.prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, req.params.id);
  }

  const updated = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id);
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

  res.json({ deleted: true });
});

// Send terminal input
router.post("/api/sessions/:sessionId/terminal/input", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId);
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
    if (!ptyProcess) {
      ptyProcess = createPty(req.params.sessionId, session.shell);
    }
    try {
      ptyProcess.write(data);
    } catch (writeErr) {
      destroyPty(req.params.sessionId);
      ptyProcess = createPty(req.params.sessionId, session.shell);
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
    .get(req.params.sessionId);
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
    .get(req.params.sessionId);
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

export default router;
