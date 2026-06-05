/**
 * Focus mode — per-room, per-member head-down signal.
 *
 * A member enters focus in a room (shield = stop receiving the room firehose;
 * solo = mute everyone else). Set by the member themselves or by an operator/
 * peer (`setter`). MVP-2 (2026-06-05): the record is now PERSISTED to the
 * `room_focus` table (was an in-memory Map) so a shield + its timer/exit-policy
 * survive a server restart — a restart must not silently un-shield a member or
 * lose who set it. Per-member, per-room. Distinct from heads-down (responder
 * relay) and room-mode (room-wide).
 *
 * Enforcement (the firehose suppression) lives in pty-inject-fanout; this store
 * is the durable source of truth it reads.
 */

import { getIdentityDb } from './db';
import { findChatRoomById } from './chatRoomStore';

export const FOCUS_REASON_MAX_LENGTH = 280;

export type FocusMode = 'shield' | 'solo';
/** What happens when a focus timer (`expiresAt`) lapses. 'stay-shielded' =
 *  never auto-release; prompt the setter + keep shielded until answered
 *  (JWPK 2026-06-05, the never-auto-dump rule). */
export type FocusExitPolicy = 'stay-shielded';

export type FocusEntry = {
  roomId: string;
  memberHandle: string;
  /** Who set the focus. Defaults to the member themselves (self-set). Used to
   *  DIRECT the timer-exit prompt (never gates voluntary self-release). */
  setter: string;
  mode: FocusMode;
  exitPolicy: FocusExitPolicy;
  reason?: string;
  enteredAt: string;
  // ISO timestamp at which the focus claim's timer lapses. null = indefinite
  // (until explicit exitFocus). Lazy expiry: list/find filter past-expiry
  // entries on read and opportunistically prune them.
  expiresAt: string | null;
};

type FocusRow = {
  room_id: string;
  member_handle: string;
  setter_handle: string;
  mode: string;
  exit_policy: string;
  reason: string | null;
  entered_at_ms: number;
  expires_at_ms: number | null;
};

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_focus (
      room_id        TEXT NOT NULL,
      member_handle  TEXT NOT NULL,
      setter_handle  TEXT NOT NULL,
      mode           TEXT NOT NULL DEFAULT 'shield' CHECK (mode IN ('shield','solo')),
      exit_policy    TEXT NOT NULL DEFAULT 'stay-shielded',
      reason         TEXT,
      entered_at_ms  INTEGER NOT NULL,
      expires_at_ms  INTEGER,
      PRIMARY KEY (room_id, member_handle)
    )
  `);
}

function rowToEntry(row: FocusRow): FocusEntry {
  return {
    roomId: row.room_id,
    memberHandle: row.member_handle,
    setter: row.setter_handle,
    mode: row.mode === 'solo' ? 'solo' : 'shield',
    exitPolicy: 'stay-shielded',
    reason: row.reason ?? undefined,
    enteredAt: new Date(row.entered_at_ms).toISOString(),
    expiresAt: row.expires_at_ms === null ? null : new Date(row.expires_at_ms).toISOString()
  };
}

function normaliseToAtHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) return trimmed;
  return `@${trimmed}`;
}

function assertHandleNonBlank(rawHandle: string): void {
  if (rawHandle.trim().length === 0) {
    throw new Error('memberHandle cannot be blank.');
  }
}

export function enterFocus(input: {
  roomId: string;
  memberHandle: string;
  /** Who set it. Omit = self-set (defaults to the member). */
  setter?: string;
  /** shield (default) = stop receiving the room; solo = mute everyone else. */
  mode?: FocusMode;
  reason?: string;
  // optional auto-clear timer. Milliseconds from now; server stamps the
  // absolute expiresAt. Omit/undefined = indefinite.
  durationMs?: number;
}): FocusEntry {
  const room = findChatRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  assertHandleNonBlank(input.memberHandle);
  const handle = normaliseToAtHandle(input.memberHandle);

  const isMember = room.members.some((member) => member.handle === handle);
  if (!isMember) {
    throw new Error(`${handle} is not a member of this room.`);
  }

  const setter =
    input.setter && input.setter.trim().length > 0
      ? normaliseToAtHandle(input.setter)
      : handle; // self-set
  const mode: FocusMode = input.mode === 'solo' ? 'solo' : 'shield';

  let trimmedReason: string | null = null;
  if (input.reason !== undefined) {
    const trimmed = input.reason.trim();
    if (trimmed.length > FOCUS_REASON_MAX_LENGTH) {
      throw new Error(`Focus reason must be ${FOCUS_REASON_MAX_LENGTH} characters or fewer.`);
    }
    trimmedReason = trimmed.length === 0 ? null : trimmed;
  }

  let expiresAtMs: number | null = null;
  if (input.durationMs !== undefined) {
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new Error('durationMs must be a positive finite number.');
    }
    expiresAtMs = Date.now() + input.durationMs;
  }

  const db = getIdentityDb();
  ensureTable(db);
  const enteredAtMs = Date.now();
  // Upsert — idempotent per (room, member); a re-enter replaces the prior row.
  db.prepare(
    `INSERT INTO room_focus
       (room_id, member_handle, setter_handle, mode, exit_policy, reason, entered_at_ms, expires_at_ms)
     VALUES (?, ?, ?, ?, 'stay-shielded', ?, ?, ?)
     ON CONFLICT(room_id, member_handle) DO UPDATE SET
       setter_handle = excluded.setter_handle,
       mode          = excluded.mode,
       exit_policy   = excluded.exit_policy,
       reason        = excluded.reason,
       entered_at_ms = excluded.entered_at_ms,
       expires_at_ms = excluded.expires_at_ms`
  ).run(input.roomId, handle, setter, mode, trimmedReason, enteredAtMs, expiresAtMs);

  return {
    roomId: input.roomId,
    memberHandle: handle,
    setter,
    mode,
    exitPolicy: 'stay-shielded',
    reason: trimmedReason ?? undefined,
    enteredAt: new Date(enteredAtMs).toISOString(),
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString()
  };
}

export function exitFocus(input: { roomId: string; memberHandle: string }): boolean {
  assertHandleNonBlank(input.memberHandle);
  const handle = normaliseToAtHandle(input.memberHandle);
  const db = getIdentityDb();
  ensureTable(db);
  const result = db
    .prepare(`DELETE FROM room_focus WHERE room_id = ? AND member_handle = ?`)
    .run(input.roomId, handle);
  return result.changes > 0;
}

// An entry has expired when its expires_at_ms is non-null and in the past.
// Indefinite entries (null) never expire.
function isExpiredMs(expiresAtMs: number | null, now: number): boolean {
  if (expiresAtMs === null) return false;
  return expiresAtMs <= now;
}

export function findFocus(roomId: string, memberHandle: string): FocusEntry | undefined {
  if (memberHandle.trim().length === 0) return undefined;
  const handle = normaliseToAtHandle(memberHandle);
  const db = getIdentityDb();
  ensureTable(db);
  const row = db
    .prepare(`SELECT * FROM room_focus WHERE room_id = ? AND member_handle = ?`)
    .get(roomId, handle) as FocusRow | undefined;
  if (!row) return undefined;
  if (isExpiredMs(row.expires_at_ms, Date.now())) {
    // Lazy prune: drop the expired row as it is observed.
    db.prepare(`DELETE FROM room_focus WHERE room_id = ? AND member_handle = ?`).run(roomId, handle);
    return undefined;
  }
  return rowToEntry(row);
}

export function listFocusedMembersInRoom(roomId: string): FocusEntry[] {
  const db = getIdentityDb();
  ensureTable(db);
  const now = Date.now();
  const rows = db
    .prepare(`SELECT * FROM room_focus WHERE room_id = ? ORDER BY entered_at_ms ASC, member_handle ASC`)
    .all(roomId) as FocusRow[];
  const survivors: FocusEntry[] = [];
  const expired: string[] = [];
  for (const row of rows) {
    if (isExpiredMs(row.expires_at_ms, now)) {
      expired.push(row.member_handle);
      continue;
    }
    survivors.push(rowToEntry(row));
  }
  // Opportunistic prune of expired rows observed during the scan.
  if (expired.length > 0) {
    const del = db.prepare(`DELETE FROM room_focus WHERE room_id = ? AND member_handle = ?`);
    for (const h of expired) del.run(roomId, h);
  }
  return survivors;
}

export function resetFocusModeStoreForTests(): void {
  const db = getIdentityDb();
  ensureTable(db);
  db.prepare(`DELETE FROM room_focus`).run();
}
