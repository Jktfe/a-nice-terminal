/**
 * roomSessionContextStore — C2 of Simplify & Harden (context-needed, deck
 * slide 9). Keyed by durable SESSION (not pid), tracks whether a session has
 * joined/read a room before, so the delivery path injects onboarding/context
 * ONLY when it actually helps — first contact, or after a long gap — instead
 * of stapling it to every message.
 *
 * Self-contained table init (answerCapsuleStore pattern) — no db.ts edit.
 */

import { getIdentityDb } from './db';

/** A session is "onboarded" again after this gap of no reads. */
export const CONTEXT_GAP_MS = 24 * 60 * 60 * 1000; // 24h

export type ContextState = {
  /** When this session first appeared in the room; null = never (first contact). */
  joinedBeforeMs: number | null;
  /** Last time this session read/received in the room; null = never. */
  lastReadAtMs: number | null;
  /** Inject onboarding/context? True on first contact or after CONTEXT_GAP_MS. */
  needsOnboarding: boolean;
};

type Row = { joined_before_ms: number | null; last_read_at_ms: number | null };

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_session_context (
      room_id         TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      joined_before_ms INTEGER,
      last_read_at_ms  INTEGER,
      PRIMARY KEY (room_id, session_id)
    );
  `);
}

/** Read the context state for a (room, session). Pure read — does NOT record
 *  a visit. needsOnboarding is computed against `nowMs`. */
export function getContextState(
  roomId: string,
  sessionId: string,
  nowMs: number = Date.now(),
  db = getIdentityDb()
): ContextState {
  ensureTable(db);
  const row = db
    .prepare(`SELECT joined_before_ms, last_read_at_ms FROM room_session_context WHERE room_id = ? AND session_id = ?`)
    .get(roomId, sessionId) as Row | undefined;
  const joinedBeforeMs = row?.joined_before_ms ?? null;
  const lastReadAtMs = row?.last_read_at_ms ?? null;
  const needsOnboarding =
    joinedBeforeMs === null || lastReadAtMs === null || nowMs - lastReadAtMs > CONTEXT_GAP_MS;
  return { joinedBeforeMs, lastReadAtMs, needsOnboarding };
}

/** Record that the session was present/read in the room at `nowMs`. Sets
 *  joined_before_ms once (first contact), always advances last_read_at_ms.
 *  Idempotent-ish: safe to call on every delivery. */
export function markContextSeen(
  roomId: string,
  sessionId: string,
  nowMs: number = Date.now(),
  db = getIdentityDb()
): ContextState {
  ensureTable(db);
  db.prepare(
    `INSERT INTO room_session_context (room_id, session_id, joined_before_ms, last_read_at_ms)
     VALUES (@room_id, @session_id, @now, @now)
     ON CONFLICT(room_id, session_id) DO UPDATE SET last_read_at_ms = @now`
  ).run({ room_id: roomId, session_id: sessionId, now: nowMs });
  return getContextState(roomId, sessionId, nowMs, db);
}
