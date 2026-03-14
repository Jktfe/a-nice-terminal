import { Router } from "express";
import db from "../db.js";
import type { DbSession } from "../types.js";

const router = Router();
const ANNOTATION_CAP = 50;
const VALID_ANNOTATION_TYPES = new Set(["thumbs_up", "thumbs_down", "flag", "star"]);

interface Annotation {
  type: string;
  by: string;
  at: string;
  note?: string;
}

router.post("/api/sessions/:sessionId/messages/:msgId/annotate", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "conversation") return res.status(409).json({ error: "Not a conversation session" });

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?")
    .get(req.params.msgId, req.params.sessionId) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });

  const { type, note } = req.body;
  if (!type || !VALID_ANNOTATION_TYPES.has(type)) {
    return res.status(400).json({ error: "Invalid annotation type" });
  }

  const by = (req.body.by as string) || "human";
  const existing: Annotation[] = msg.annotations ? JSON.parse(msg.annotations) : [];

  const matchIdx = existing.findIndex((a) => a.type === type && a.by === by);

  let updated: Annotation[];
  if (matchIdx >= 0) {
    updated = existing.filter((_, i) => i !== matchIdx);
  } else {
    if (existing.length >= ANNOTATION_CAP) {
      return res.status(400).json({ error: `Maximum ${ANNOTATION_CAP} annotations per message` });
    }
    const annotation: Annotation = { type, by, at: new Date().toISOString() };
    if (note) annotation.note = String(note).slice(0, 500);
    updated = [...existing, annotation];
  }

  const annotationsJson = updated.length > 0 ? JSON.stringify(updated) : null;
  const isStarred = type === "star"
    ? (updated.some((a) => a.type === "star") ? 1 : 0)
    : (msg.starred || 0);

  db.prepare("UPDATE messages SET annotations = ?, starred = ? WHERE id = ?")
    .run(annotationsJson, isStarred, req.params.msgId);

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("annotation_changed", {
      messageId: req.params.msgId,
      annotations: updated,
      starred: isStarred,
    });
  }

  res.json({ annotations: updated, starred: isStarred });
});

export default router;
