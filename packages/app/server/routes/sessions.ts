import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { destroyPty } from "../pty-manager.js";

const router = Router();

// List sessions
router.get("/api/sessions", (_req, res) => {
  const sessions = db
    .prepare(
      "SELECT * FROM sessions ORDER BY updated_at DESC"
    )
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
    return res.status(400).json({ error: "Invalid session type. Must be 'terminal' or 'conversation'." });
  }

  const id = nanoid(12);
  const sessionName = name || (type === "terminal" ? "Terminal" : "Conversation");

  db.prepare(
    "INSERT INTO sessions (id, name, type, shell) VALUES (?, ?, ?, ?)"
  ).run(id, sessionName, type, null);

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

  const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
  res.json(updated);
});

// Delete session
router.delete("/api/sessions/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM sessions WHERE id = ?")
    .run(req.params.id);

  if (result.changes === 0)
    return res.status(404).json({ error: "Session not found" });

  // Clean up PTY process if this was a terminal session
  destroyPty(req.params.id);

  res.json({ deleted: true });
});

export default router;
