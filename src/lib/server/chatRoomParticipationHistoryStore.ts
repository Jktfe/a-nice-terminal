/**
 * Cross-room participation history.
 *
 * Records every (globalHandle, roomId) pair seen across the lifetime of
 * the process so the mention autocomplete can surface prior collaborators
 * as the third ranking tier per WTHef h05 board note.
 *
 * Backs M03 slice 4.1 prior collaborators. Adding a member to a room
 * via invite or create-as-creator calls recordParticipation. The mention
 * autocomplete reads via listPriorCollaboratorsExcludingRoom so the
 * suggestions never include people who are already in the current room
 * (those rank above in tier two).
 *
 * In-memory shape matches the rest of the fresh-ant stores. SQLite-backed
 * persistence lands when the data layer ships.
 */

export type ParticipationEntry = {
  globalHandle: string;
  roomId: string;
  firstSeenAt: string;
};

const participationByHandle = new Map<string, Map<string, ParticipationEntry>>();

function entriesForHandle(globalHandle: string): Map<string, ParticipationEntry> {
  const existing = participationByHandle.get(globalHandle);
  if (existing) return existing;
  const freshMap = new Map<string, ParticipationEntry>();
  participationByHandle.set(globalHandle, freshMap);
  return freshMap;
}

export function recordParticipation(input: { globalHandle: string; roomId: string }): void {
  const trimmedHandle = input.globalHandle.trim();
  const trimmedRoom = input.roomId.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('recordParticipation needs a non-blank globalHandle.');
  }
  if (trimmedRoom.length === 0) {
    throw new Error('recordParticipation needs a non-blank roomId.');
  }

  const handleEntries = entriesForHandle(trimmedHandle);
  if (handleEntries.has(trimmedRoom)) return;

  handleEntries.set(trimmedRoom, {
    globalHandle: trimmedHandle,
    roomId: trimmedRoom,
    firstSeenAt: new Date().toISOString()
  });
}

/**
 * Returns every globalHandle that has appeared in any room other than
 * `excludeRoomId`, optionally filtered by a case-insensitive substring
 * match against `partialMatch`. One row per handle even when the handle
 * has participated in many rooms.
 */
export function listPriorCollaboratorsExcludingRoom(
  excludeRoomId: string,
  partialMatch = ''
): string[] {
  const needleLower = partialMatch.toLowerCase();

  const matchingHandles: string[] = [];
  for (const [handle, rooms] of participationByHandle.entries()) {
    const hasOtherRoom = Array.from(rooms.keys()).some((roomId) => roomId !== excludeRoomId);
    if (!hasOtherRoom) continue;
    if (needleLower.length > 0 && !handle.toLowerCase().includes(needleLower)) continue;
    matchingHandles.push(handle);
  }

  return matchingHandles.sort((leftHandle, rightHandle) =>
    leftHandle.localeCompare(rightHandle)
  );
}

export function resetChatRoomParticipationHistoryStoreForTests(): void {
  participationByHandle.clear();
}
