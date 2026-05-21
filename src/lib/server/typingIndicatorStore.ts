/**
 * In-memory store of who is currently typing in each chat room.
 *
 * Vertical slice for M19 typing-indicator (wireframe board KS1Bf), backend only.
 * Slice 1 ships the data shape + heartbeat API. ChatComposer wiring + the
 * dots-rendering component land in slice 2 once claude2 slice 4 has settled
 * the ChatComposer split.
 *
 * Heartbeat model: a member calls recordTypingHeartbeat every time they type
 * a character. listActiveTypersInRoom returns whoever heart-beat within the
 * last 5 seconds. That window is short enough that stale entries fade out
 * without an explicit "stopped typing" call.
 */

const TYPING_WINDOW_MILLISECONDS = 5 * 1000;

type LastTypedAtByHandle = Map<string, number>;

const typersByRoomId = new Map<string, LastTypedAtByHandle>();

function lastTypedAtMapForRoom(roomId: string): LastTypedAtByHandle {
  const existing = typersByRoomId.get(roomId);
  if (existing) return existing;
  const fresh: LastTypedAtByHandle = new Map();
  typersByRoomId.set(roomId, fresh);
  return fresh;
}

export type TypingHeartbeatInput = {
  roomId: string;
  memberHandle: string;
};

export function recordTypingHeartbeat(input: TypingHeartbeatInput): void {
  const trimmedHandle = input.memberHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('A typing heartbeat needs a non-empty member handle.');
  }
  lastTypedAtMapForRoom(input.roomId).set(trimmedHandle, Date.now());
}

export type ActiveTyper = {
  memberHandle: string;
  lastTypedAtMillisecondsAgo: number;
};

export function listActiveTypersInRoom(roomId: string): ActiveTyper[] {
  const lastTypedAtByHandle = typersByRoomId.get(roomId);
  if (!lastTypedAtByHandle) return [];

  const cutoffWasAt = Date.now() - TYPING_WINDOW_MILLISECONDS;
  const stillTyping: ActiveTyper[] = [];

  for (const [memberHandle, lastTypedAt] of lastTypedAtByHandle.entries()) {
    if (lastTypedAt < cutoffWasAt) {
      lastTypedAtByHandle.delete(memberHandle);
      continue;
    }
    stillTyping.push({
      memberHandle,
      lastTypedAtMillisecondsAgo: Date.now() - lastTypedAt
    });
  }

  return stillTyping.sort((leftTyper, rightTyper) => {
    return leftTyper.memberHandle.localeCompare(rightTyper.memberHandle);
  });
}

export function resetTypingIndicatorStoreForTests(): void {
  typersByRoomId.clear();
}
