import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

type Role = "human" | "agent" | "system";

const VALID_FORMATS = new Set(["markdown", "text", "plaintext", "json"]);
const VALID_STATUSES = ["pending", "streaming", "complete"] as const;

const router = Router();

function normalizeRole(role: string): Role | null {
  switch (role) {
    case "human":
      return "human";
    case "user":
      return "human";
    case "agent":
    case "assistant":
      return "agent";
    case "system":
      return "system";
    default:
      return null;
  }
}

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
}

function ensureConversationSession(sessionId: string, res: any): any | null {
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

  const { since, limit = "100" } = req.query;

  let query = "SELECT * FROM messages WHERE session_id = ?";
  const params: any[] = [req.params.sessionId];

  if (since) {
    query += " AND created_at > ?";
    params.push(since as string);
  }

  query += " ORDER BY created_at ASC LIMIT ?";
  const parsedLimit = Math.max(1, Math.min(parseInt(limit as string, 10) || 100, 1000));
  params.push(parsedLimit);

  const messages = db.prepare(query).all(...params);
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

  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, format, status) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    req.params.sessionId,
    normalisedRole,
    content,
    format,
    status
  );

  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(
    req.params.sessionId
  );

  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_created", message);
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

  const { content, status } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (
    content !== undefined &&
    (typeof content !== "string" || content.length > 100_000)
  ) {
    return res.status(400).json({ error: "Content too large" });
  }

  if (content !== undefined && status !== undefined) {
    db.prepare("UPDATE messages SET content = ?, status = ? WHERE id = ?").run(
      content,
      status,
      req.params.id
    );
  } else if (content !== undefined) {
    db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(
      content,
      req.params.id
    );
  } else if (status !== undefined) {
    db.prepare("UPDATE messages SET status = ? WHERE id = ?").run(
      status,
      req.params.id
    );
  }

  const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id);
  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_updated", updated);
  }

  res.json(updated);
});

// Delete message
router.delete("/api/sessions/:sessionId/messages/:id", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const result = db
    .prepare("DELETE FROM messages WHERE id = ? AND session_id = ?")
    .run(req.params.id, req.params.sessionId);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Message not found" });
  }

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_deleted", { id: req.params.id });
  }

  res.json({ deleted: true });
});

export default router;
