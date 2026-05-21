/**
 * Focus mode — per-room, per-member head-down signal.
 *
 * One member can enter focus in a room with an optional reason
 * ("writing PR description", "deep review"). Other members and the
 * chair digest can render this so people know when not to interrupt.
 *
 * Backs the "Focus mode" capability ledger row. UI wiring is a later
 * slice; this slice ships the store + endpoint surface only.
 */

import { findChatRoomById } from './chatRoomStore';

export const FOCUS_REASON_MAX_LENGTH = 280;

export type FocusEntry = {
  roomId: string;
  memberHandle: string;
  reason?: string;
  enteredAt: string;
  // FOCUS-DURATION (2026-05-15, JWPK): ISO timestamp at which the
  // focus claim auto-clears. null = indefinite (until explicit exitFocus).
  // Lazy expiry: list/find filter past-expiry entries on read and
  // opportunistically prune them from the underlying map.
  expiresAt: string | null;
};

const focusByRoomThenMember = new Map<string, Map<string, FocusEntry>>();

function focusMapForRoom(roomId: string): Map<string, FocusEntry> {
  const existing = focusByRoomThenMember.get(roomId);
  if (existing) return existing;
  const freshMapForRoom = new Map<string, FocusEntry>();
  focusByRoomThenMember.set(roomId, freshMapForRoom);
  return freshMapForRoom;
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
  reason?: string;
  // FOCUS-DURATION: optional auto-clear timer. Milliseconds from now;
  // server stamps the absolute expiresAt. Omit/undefined = indefinite.
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

  let trimmedReason: string | undefined;
  if (input.reason !== undefined) {
    const trimmed = input.reason.trim();
    if (trimmed.length > FOCUS_REASON_MAX_LENGTH) {
      throw new Error(`Focus reason must be ${FOCUS_REASON_MAX_LENGTH} characters or fewer.`);
    }
    trimmedReason = trimmed.length === 0 ? undefined : trimmed;
  }

  let expiresAt: string | null = null;
  if (input.durationMs !== undefined) {
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new Error('durationMs must be a positive finite number.');
    }
    expiresAt = new Date(Date.now() + input.durationMs).toISOString();
  }

  const entry: FocusEntry = {
    roomId: input.roomId,
    memberHandle: handle,
    reason: trimmedReason,
    enteredAt: new Date().toISOString(),
    expiresAt
  };

  focusMapForRoom(input.roomId).set(handle, entry);
  return entry;
}

export function exitFocus(input: { roomId: string; memberHandle: string }): boolean {
  assertHandleNonBlank(input.memberHandle);
  const handle = normaliseToAtHandle(input.memberHandle);
  return focusMapForRoom(input.roomId).delete(handle);
}

// FOCUS-DURATION: an entry has expired when its `expiresAt` is non-null
// and lies in the past. Indefinite entries (expiresAt === null) never
// expire.
function isExpired(entry: FocusEntry, now: number): boolean {
  if (entry.expiresAt === null) return false;
  return new Date(entry.expiresAt).getTime() <= now;
}

export function findFocus(roomId: string, memberHandle: string): FocusEntry | undefined {
  if (memberHandle.trim().length === 0) return undefined;
  const handle = normaliseToAtHandle(memberHandle);
  const map = focusMapForRoom(roomId);
  const entry = map.get(handle);
  if (!entry) return undefined;
  if (isExpired(entry, Date.now())) {
    // Lazy prune: keep the map bounded as expired entries are observed.
    map.delete(handle);
    return undefined;
  }
  return entry;
}

export function listFocusedMembersInRoom(roomId: string): FocusEntry[] {
  const map = focusMapForRoom(roomId);
  const now = Date.now();
  const survivors: FocusEntry[] = [];
  for (const [handle, entry] of map) {
    if (isExpired(entry, now)) {
      map.delete(handle); // opportunistic prune during iteration
      continue;
    }
    survivors.push(entry);
  }
  return survivors.sort((leftEntry, rightEntry) => {
    if (leftEntry.enteredAt < rightEntry.enteredAt) return -1;
    if (leftEntry.enteredAt > rightEntry.enteredAt) return 1;
    return 0;
  });
}

export function resetFocusModeStoreForTests(): void {
  focusByRoomThenMember.clear();
}
