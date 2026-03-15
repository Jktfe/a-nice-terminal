import { Router } from "express";
import db from "../db.js";
import type { DbSession } from "../types.js";

const router = Router();
const ANNOTATION_CAP = 50;
const VALID_ANNOTATION_TYPES = new Set(["thumbs_up", "thumbs_down", "flag", "star", "session_rating"]);

interface SessionRatingData {
  sentiment?: "up" | "down";
  outcome?: number;
  speed?: number;
  trust?: number;
}

interface Annotation {
  type: string;
  by: string;
  at: string;
  note?: string;
  data?: SessionRatingData;
}

function sanitizeSessionRatingData(input: unknown): SessionRatingData | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;

  const raw = input as Record<string, unknown>;
  const next: SessionRatingData = {};

  if (raw.sentiment === "up" || raw.sentiment === "down") {
    next.sentiment = raw.sentiment;
  }

  for (const key of ["outcome", "speed", "trust"] as const) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      throw new Error(`Invalid ${key} rating`);
    }
    next[key] = parsed;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function annotationsEqual(a: Annotation, b: Annotation): boolean {
  return JSON.stringify({ note: a.note ?? null, data: a.data ?? null }) ===
    JSON.stringify({ note: b.note ?? null, data: b.data ?? null });
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

  let data: SessionRatingData | undefined;
  try {
    data = sanitizeSessionRatingData(req.body.data);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid rating data" });
  }

  const by = (req.body.by as string) || "human";
  const existing: Annotation[] = msg.annotations ? JSON.parse(msg.annotations) : [];

  const matchIdx = existing.findIndex((a) => a.type === type && a.by === by);

  let updated: Annotation[];
  if (matchIdx >= 0) {
    const replacement: Annotation = {
      type,
      by,
      at: new Date().toISOString(),
    };
    if (note) replacement.note = String(note).slice(0, 500);
    if (data) replacement.data = data;

    if (annotationsEqual(existing[matchIdx], replacement)) {
      updated = existing.filter((_, i) => i !== matchIdx);
    } else {
      updated = existing.map((annotation, i) => i === matchIdx ? replacement : annotation);
    }
  } else {
    if (existing.length >= ANNOTATION_CAP) {
      return res.status(400).json({ error: `Maximum ${ANNOTATION_CAP} annotations per message` });
    }
    const annotation: Annotation = { type, by, at: new Date().toISOString() };
    if (note) annotation.note = String(note).slice(0, 500);
    if (data) annotation.data = data;
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

router.get("/api/sessions/:sessionId/ratings", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "conversation") return res.status(409).json({ error: "Not a conversation session" });

  const rows = db.prepare(
    "SELECT id, annotations FROM messages WHERE session_id = ? AND annotations IS NOT NULL ORDER BY created_at ASC"
  ).all(req.params.sessionId) as Array<{ id: string; annotations: string }>;

  const ratings = rows.flatMap((row) => {
    const annotations: Annotation[] = JSON.parse(row.annotations);
    return annotations
      .filter((annotation) => annotation.type === "session_rating")
      .map((annotation) => ({
        messageId: row.id,
        by: annotation.by,
        at: annotation.at,
        note: annotation.note,
        sentiment: annotation.data?.sentiment ?? null,
        outcome: annotation.data?.outcome ?? null,
        speed: annotation.data?.speed ?? null,
        trust: annotation.data?.trust ?? null,
      }));
  });

  const average = (key: "outcome" | "speed" | "trust") => {
    const values = ratings.map((rating) => rating[key]).filter((value): value is number => typeof value === "number");
    if (values.length === 0) return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  };

  res.json({
    sessionId: req.params.sessionId,
    total: ratings.length,
    positive: ratings.filter((rating) => rating.sentiment === "up").length,
    negative: ratings.filter((rating) => rating.sentiment === "down").length,
    averages: {
      outcome: average("outcome"),
      speed: average("speed"),
      trust: average("trust"),
    },
    ratings,
  });
});

export default router;
