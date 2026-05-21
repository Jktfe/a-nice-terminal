/**
 * realtimeRoomPool — refcounted EventSource pool keyed by roomId.
 *
 * Why this exists (Bug #room-card-nav-stall):
 *   Every <RoomCardActivity> + <AgentStatusFooter> instance previously
 *   spawned its own EventSource via subscribeToRoomEvents. The /rooms
 *   index renders one card per room — with 8+ rooms attached, the page
 *   opens 8+ concurrent SSE sockets. Chrome caps persistent HTTP/1.1
 *   connections at ~6 per origin. The remaining sockets queue and starve
 *   SvelteKit's client-navigation fetch for the destination page, so
 *   clicking a card appears to do nothing — the URL never updates and
 *   no error fires. The dashboard (5 cards) stayed under the cap and
 *   so still worked, which is why this only showed up on /rooms.
 *
 * Contract:
 *   - subscribe(roomId, callback) returns an unsubscribe handle
 *   - First subscriber for a roomId opens the EventSource
 *   - Subsequent subscribers reuse the same source; refcount goes up
 *   - The source closes when the refcount hits zero
 *   - SSR-safe: no-ops when window/EventSource are undefined
 *
 * Counterpart: the existing per-handle subscribeToRoomEvents in
 * realtimeRoom.svelte.ts is kept for surfaces that genuinely need an
 * independent connection (room view, message read state), but anything
 * that renders many concurrent rooms should go through the pool.
 */

type PoolEntry = {
  source: EventSource;
  refCount: number;
  callbacks: Set<(event: Record<string, unknown>) => void>;
  lastEvent: Record<string, unknown> | null;
  eventCount: number;
};

const pool = new Map<string, PoolEntry>();

export type SharedRoomEventsHandle = {
  /** Increment-only event counter; flip a $derived on this to react. */
  readonly eventCount: number;
  /** Most recent event payload (null until the first event arrives). */
  readonly lastEvent: Record<string, unknown> | null;
  /** Drop this subscriber; closes the underlying source at refcount 0. */
  close: () => void;
};

export function subscribeToSharedRoomEvents(
  roomId: string,
  onEvent?: (event: Record<string, unknown>) => void
): SharedRoomEventsHandle {
  let eventCount = $state(0);
  let lastEvent = $state<Record<string, unknown> | null>(null);

  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return {
      get eventCount() { return eventCount; },
      get lastEvent() { return lastEvent; },
      close() { /* no-op SSR */ }
    };
  }

  const entry = pool.get(roomId) ?? createEntry(roomId);
  entry.refCount += 1;

  const localCallback = (event: Record<string, unknown>) => {
    lastEvent = event;
    eventCount += 1;
    onEvent?.(event);
  };
  entry.callbacks.add(localCallback);

  // Replay the latest event so a late subscriber lights up immediately
  // instead of waiting for the next server tick.
  if (entry.lastEvent) {
    lastEvent = entry.lastEvent;
    eventCount = entry.eventCount;
  }

  return {
    get eventCount() { return eventCount; },
    get lastEvent() { return lastEvent; },
    close() {
      const current = pool.get(roomId);
      if (!current) return;
      current.callbacks.delete(localCallback);
      current.refCount -= 1;
      if (current.refCount <= 0) {
        current.source.close();
        pool.delete(roomId);
      }
    }
  };
}

function createEntry(roomId: string): PoolEntry {
  const source = new EventSource(`/api/realtime/${encodeURIComponent(roomId)}/events`);
  const entry: PoolEntry = {
    source,
    refCount: 0,
    callbacks: new Set(),
    lastEvent: null,
    eventCount: 0
  };
  source.onmessage = (msg) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(msg.data) as Record<string, unknown>;
    } catch {
      return;
    }
    entry.lastEvent = parsed;
    entry.eventCount += 1;
    for (const cb of entry.callbacks) cb(parsed);
  };
  pool.set(roomId, entry);
  return entry;
}

/** Test-only: inspect current pool state. */
export function _poolSnapshot(): { roomIds: string[]; refCounts: Record<string, number> } {
  const refCounts: Record<string, number> = {};
  for (const [roomId, entry] of pool) refCounts[roomId] = entry.refCount;
  return { roomIds: [...pool.keys()], refCounts };
}
