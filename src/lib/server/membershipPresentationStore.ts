/**
 * membershipPresentationStore — the "elsewhere" the clean membership spec
 * points to.
 *
 * `room_membership` is deliberately minimal: `(room_id, handle, session_id)` —
 * who is in the room and what session their handle resolves to. It explicitly
 * does NOT carry per-room PRESENTATION (display colour / icon / background /
 * member-kind / room-scoped display name). The legacy `chat_room_members` and
 * the v0.2 `memberships` tables conflated identity with presentation; the clean
 * model splits them. This store is that split — a separate per-(room,handle)
 * presentation row, joined to `room_membership` at read time.
 *
 * Part of the R3 membership consolidation (2026-06-05): the dashboard's
 * participant presentation currently reads the v0.2 `memberships` table; once a
 * reader migrates onto `room_membership`, it reads presentation from HERE. This
 * store is purely additive — it touches no existing table and changes no
 * existing behaviour, so it ships ahead of the (atomic, higher-risk) reader
 * cut-over with zero blast radius.
 *
 * Keyed by HANDLE (the durable identity in the clean model), not session/
 * terminal — presentation follows the handle across reconnects, exactly like
 * membership does. Self-contained table init (roomPolicyStore pattern).
 */

import { getIdentityDb } from './db';

export type MemberPresentation = {
  room_id: string;
  handle: string;
  /** Per-room display name override; null = inherit the agent/handle's name. */
  room_display_name: string | null;
  display_color: string | null;
  display_icon: string | null;
  display_background_style: string | null;
  /** e.g. 'human' | 'agent' — how the member is rendered; null = infer. */
  member_kind: string | null;
  updated_at_ms: number;
};

type PresentationRow = {
  room_id: string;
  handle: string;
  room_display_name: string | null;
  display_color: string | null;
  display_icon: string | null;
  display_background_style: string | null;
  member_kind: string | null;
  updated_at_ms: number;
};

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_member_presentation (
      room_id                  TEXT NOT NULL,
      handle                   TEXT NOT NULL,
      room_display_name        TEXT,
      display_color            TEXT,
      display_icon             TEXT,
      display_background_style TEXT,
      member_kind              TEXT,
      updated_at_ms            INTEGER NOT NULL,
      PRIMARY KEY (room_id, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_room_member_presentation_room
      ON room_member_presentation (room_id);
  `);
}

function rowToPresentation(r: PresentationRow): MemberPresentation {
  return {
    room_id: r.room_id,
    handle: r.handle,
    room_display_name: r.room_display_name,
    display_color: r.display_color,
    display_icon: r.display_icon,
    display_background_style: r.display_background_style,
    member_kind: r.member_kind,
    updated_at_ms: r.updated_at_ms
  };
}

export type PresentationPatch = {
  room_display_name?: string | null;
  display_color?: string | null;
  display_icon?: string | null;
  display_background_style?: string | null;
  member_kind?: string | null;
};

/**
 * Upsert presentation for (room, handle). Only the fields PRESENT in the patch
 * are written; omitted fields are preserved (partial update), so a caller that
 * only changes the colour doesn't clobber the icon. Passing an explicit `null`
 * clears that field.
 */
export function setMemberPresentation(
  roomId: string,
  handle: string,
  patch: PresentationPatch,
  db = getIdentityDb()
): MemberPresentation {
  ensureTable(db);
  const now = Date.now();
  const existing = getMemberPresentation(roomId, handle, db);
  const merged = {
    room_display_name: 'room_display_name' in patch ? patch.room_display_name ?? null : existing?.room_display_name ?? null,
    display_color: 'display_color' in patch ? patch.display_color ?? null : existing?.display_color ?? null,
    display_icon: 'display_icon' in patch ? patch.display_icon ?? null : existing?.display_icon ?? null,
    display_background_style: 'display_background_style' in patch ? patch.display_background_style ?? null : existing?.display_background_style ?? null,
    member_kind: 'member_kind' in patch ? patch.member_kind ?? null : existing?.member_kind ?? null
  };
  db.prepare(
    `INSERT INTO room_member_presentation
       (room_id, handle, room_display_name, display_color, display_icon,
        display_background_style, member_kind, updated_at_ms)
     VALUES (@room_id, @handle, @room_display_name, @display_color, @display_icon,
             @display_background_style, @member_kind, @updated_at_ms)
     ON CONFLICT (room_id, handle) DO UPDATE SET
       room_display_name = excluded.room_display_name,
       display_color = excluded.display_color,
       display_icon = excluded.display_icon,
       display_background_style = excluded.display_background_style,
       member_kind = excluded.member_kind,
       updated_at_ms = excluded.updated_at_ms`
  ).run({ room_id: roomId, handle, ...merged, updated_at_ms: now });
  return getMemberPresentation(roomId, handle, db) as MemberPresentation;
}

/** Presentation for one (room, handle), or null if none set. */
export function getMemberPresentation(
  roomId: string,
  handle: string,
  db = getIdentityDb()
): MemberPresentation | null {
  ensureTable(db);
  const row = db
    .prepare(`SELECT * FROM room_member_presentation WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as PresentationRow | undefined;
  return row ? rowToPresentation(row) : null;
}

/** All presentation rows in a room, keyed for a join against room_membership. */
export function listPresentationForRoom(
  roomId: string,
  db = getIdentityDb()
): MemberPresentation[] {
  ensureTable(db);
  const rows = db
    .prepare(`SELECT * FROM room_member_presentation WHERE room_id = ? ORDER BY handle ASC`)
    .all(roomId) as PresentationRow[];
  return rows.map(rowToPresentation);
}

/**
 * One-time CALLABLE backfill: populate room_member_presentation from the legacy
 * `chat_room_members` presentation columns, so the dashboard read-flip operates
 * on a COMPLETE table (every existing member, not just those who've updated
 * presentation since the dual-write shipped). Idempotent (upsert). Returns a
 * count report. Safe on a DB with no chat_room_members table (fresh/test).
 */
export function backfillPresentationFromChatRoomMembers(
  db = getIdentityDb()
): { scanned: number; written: number } {
  ensureTable(db);
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='chat_room_members'`)
    .get();
  if (!tableExists) return { scanned: 0, written: 0 };

  const rows = db
    .prepare(
      `SELECT room_id, handle, display_name, kind, display_color, display_icon,
              display_background_style
         FROM chat_room_members`
    )
    .all() as Array<{
    room_id: string;
    handle: string;
    display_name: string | null;
    kind: string | null;
    display_color: string | null;
    display_icon: string | null;
    display_background_style: string | null;
  }>;

  let written = 0;
  for (const r of rows) {
    setMemberPresentation(
      r.room_id,
      r.handle,
      {
        room_display_name: r.display_name ?? null,
        display_color: r.display_color ?? null,
        display_icon: r.display_icon ?? null,
        display_background_style: r.display_background_style ?? null,
        member_kind: r.kind ?? null
      },
      db
    );
    written++;
  }
  return { scanned: rows.length, written };
}

/** Drop a member's presentation (e.g. when they leave). Returns true if removed. */
export function removeMemberPresentation(
  roomId: string,
  handle: string,
  db = getIdentityDb()
): boolean {
  ensureTable(db);
  const res = db
    .prepare(`DELETE FROM room_member_presentation WHERE room_id = ? AND handle = ?`)
    .run(roomId, handle);
  return res.changes > 0;
}
