/**
 * Per-room handle aliases.
 *
 * One member can be shown under a different handle inside a single room.
 * The global handle stays locked; the alias is purely cosmetic and lives
 * only in this store.
 *
 * Vertical slice for M03 participants panel (wireframe board WTHef,
 * change-handle state h03).
 *
 * The alias store is the single source of truth for per-room display
 * names. RoomMember does not mirror the alias; presentation looks it up
 * here at render time so a global rename can never leave a stale mirror.
 */

import { findChatRoomById } from './chatRoomStore';

export type RoomAliasEntry = {
  roomId: string;
  globalHandle: string;
  alias: string;
  setAt: string;
};

const aliasesByRoomId = new Map<string, Map<string, RoomAliasEntry>>();

function aliasMapForRoom(roomId: string): Map<string, RoomAliasEntry> {
  const existing = aliasesByRoomId.get(roomId);
  if (existing) return existing;
  const freshMapForRoom = new Map<string, RoomAliasEntry>();
  aliasesByRoomId.set(roomId, freshMapForRoom);
  return freshMapForRoom;
}

function normaliseToAtHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) return trimmed;
  return `@${trimmed}`;
}

function isMemberOfRoom(roomId: string, globalHandle: string): boolean {
  const room = findChatRoomById(roomId);
  if (!room) return false;
  return room.members.some((member) => member.handle === globalHandle);
}

export function findAliasForHandleInRoom(
  roomId: string,
  globalHandle: string
): string | undefined {
  return aliasMapForRoom(roomId).get(globalHandle)?.alias;
}

export function listAliasesForRoom(roomId: string): RoomAliasEntry[] {
  return Array.from(aliasMapForRoom(roomId).values());
}

/**
 * Returns the global handle that already uses `candidateAlias` in this
 * room, or undefined when nothing collides. A member is allowed to keep
 * their own alias, so we skip their row when `ignoreGlobalHandle` is set.
 */
export function findCollisionForAlias(input: {
  roomId: string;
  candidateAlias: string;
  ignoreGlobalHandle?: string;
}): string | undefined {
  const room = findChatRoomById(input.roomId);
  if (!room) return undefined;
  const candidate = normaliseToAtHandle(input.candidateAlias);

  for (const member of room.members) {
    if (member.handle === input.ignoreGlobalHandle) continue;
    if (member.handle === candidate) return member.handle;
  }

  for (const entry of aliasMapForRoom(input.roomId).values()) {
    if (entry.globalHandle === input.ignoreGlobalHandle) continue;
    if (entry.alias === candidate) return entry.globalHandle;
  }

  return undefined;
}

export function setRoomAlias(input: {
  roomId: string;
  globalHandle: string;
  newAlias: string;
}): RoomAliasEntry {
  if (!findChatRoomById(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }
  if (!isMemberOfRoom(input.roomId, input.globalHandle)) {
    throw new Error(`${input.globalHandle} is not a member of this room.`);
  }

  const trimmedAlias = input.newAlias.trim();
  if (trimmedAlias.length === 0) {
    throw new Error('A room alias cannot be blank.');
  }

  const aliasWithAt = normaliseToAtHandle(trimmedAlias);

  const collidesWith = findCollisionForAlias({
    roomId: input.roomId,
    candidateAlias: aliasWithAt,
    ignoreGlobalHandle: input.globalHandle
  });
  if (collidesWith) {
    throw new RoomAliasCollisionError(aliasWithAt, collidesWith);
  }

  const entry: RoomAliasEntry = {
    roomId: input.roomId,
    globalHandle: input.globalHandle,
    alias: aliasWithAt,
    setAt: new Date().toISOString()
  };

  aliasMapForRoom(input.roomId).set(input.globalHandle, entry);
  return entry;
}

export function removeRoomAlias(input: {
  roomId: string;
  globalHandle: string;
}): boolean {
  return aliasMapForRoom(input.roomId).delete(input.globalHandle);
}

export function resetChatRoomAliasStoreForTests(): void {
  aliasesByRoomId.clear();
}

export class RoomAliasCollisionError extends Error {
  alias: string;
  collidesWith: string;

  constructor(alias: string, collidesWith: string) {
    super(`${alias} is already used by ${collidesWith} in this room.`);
    this.name = 'RoomAliasCollisionError';
    this.alias = alias;
    this.collidesWith = collidesWith;
  }
}
