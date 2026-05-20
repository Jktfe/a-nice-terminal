/**
 * chairHandoffStore — chair handoff state + history per M4.4 Q2 + Q6.
 *
 * Two surfaces:
 *   - chat_rooms.current_chair_handle (single TEXT column on chat_rooms)
 *   - chat_room_chair_history (append-only audit table)
 *
 * Public functions kept narrow:
 *   - setRoomChair({ roomId, toHandle, setBy }) — validate room exists +
 *     toHandle is a current chat_room_members row + write both surfaces in
 *     one db.transaction. Idempotent: handing off to the current chair is
 *     a no-op (no history row).
 *   - getRoomChair(roomId): string | null
 *   - listChairHistoryForRoom(roomId, limit?): newest-first audit rows
 *
 * Caller-membership invariant (Q2 invariant 1) is enforced by the /messages
 * route's pidChain-strict gate via resolveCallerIdentityStrict — the store
 * itself accepts any setBy handle, matching the discussion_id permissive
 * precedent. T2 route will run resolveCallerIdentityStrict before calling
 * setRoomChair.
 */
import { getIdentityDb } from './db';
import { findChatRoomById } from './chatRoomStore';

export type ChairHistoryRow = {
  id: number;
  room_id: string;
  from_handle: string | null;
  to_handle: string;
  set_by: string;
  set_at_ms: number;
};

export type SetRoomChairInput = {
  roomId: string;
  toHandle: string;
  setBy: string;
  nowMs?: number;
};

export type SetRoomChairResult = {
  roomId: string;
  currentChairHandle: string;
  changed: boolean;
};

export class ChairTargetNotMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChairTargetNotMemberError';
  }
}

function isMember(roomId: string, handle: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT 1 AS present FROM chat_room_members WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as { present: number } | undefined;
  return row !== undefined;
}

export function setRoomChair(input: SetRoomChairInput): SetRoomChairResult {
  const room = findChatRoomById(input.roomId);
  if (!room) throw new Error(`No room found with id ${input.roomId}.`);

  if (!isMember(input.roomId, input.toHandle)) {
    throw new ChairTargetNotMemberError(
      `${input.toHandle} is not a member of room ${input.roomId}.`
    );
  }

  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const existing = getRoomChair(input.roomId);
  if (existing === input.toHandle) {
    return {
      roomId: input.roomId,
      currentChairHandle: input.toHandle,
      changed: false
    };
  }

  const txn = db.transaction(() => {
    db.prepare(`UPDATE chat_rooms SET current_chair_handle = ? WHERE id = ?`).run(
      input.toHandle, input.roomId
    );
    db.prepare(`INSERT INTO chat_room_chair_history
      (room_id, from_handle, to_handle, set_by, set_at_ms)
      VALUES (?, ?, ?, ?, ?)`).run(
      input.roomId, existing, input.toHandle, input.setBy, nowMs
    );
  });
  txn();

  return {
    roomId: input.roomId,
    currentChairHandle: input.toHandle,
    changed: true
  };
}

export function getRoomChair(roomId: string): string | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT current_chair_handle FROM chat_rooms WHERE id = ?`)
    .get(roomId) as { current_chair_handle: string | null } | undefined;
  return row?.current_chair_handle ?? null;
}

export function listChairHistoryForRoom(roomId: string, limit: number = 50): ChairHistoryRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT id, room_id, from_handle, to_handle, set_by, set_at_ms
              FROM chat_room_chair_history WHERE room_id = ?
              ORDER BY set_at_ms DESC LIMIT ?`)
    .all(roomId, limit) as ChairHistoryRow[];
}

export function resetChairHandoffStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM chat_room_chair_history').run();
  db.prepare('UPDATE chat_rooms SET current_chair_handle = NULL').run();
}
