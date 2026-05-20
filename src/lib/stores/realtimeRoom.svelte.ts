/**
 * realtimeRoom — EventSource subscriber for one chat room (GAP-55 T2-A).
 * Returns a $state-backed counter the page can $effect on to call
 * invalidateAll() when a new event arrives. Auto-reconnects on transient
 * network failure (EventSource handles this natively).
 *
 * Hardening delta (Lane B, 2026-05-16):
 *   - onConnect callback fires on every EventSource open (initial + reconnect).
 *   - Caller should call invalidateAll() inside onConnect so the page
 *     re-fetches the full message list after any disconnect/reconnect.
 *   - This closes the gap where stale state persists if no new events
 *     arrive after a network partition.
 */

export type RealtimeRoomHandle = {
  readonly eventCount: number;
  readonly lastEvent: Record<string, unknown> | null;
  readonly connected: boolean;
  close: () => void;
};

// Refcounted shared pool keyed by roomId. Previously each caller opened
// its own EventSource (room page + AgentStatusFooter + ParticipantsPanel
// = 3 SSE sockets per room), saturating Chrome's HTTP/1.1 cap and
// crashing tabs on active rooms. Now all callers share one EventSource
// per roomId, the way realtimeRoomPool already did for /rooms cards.
type PoolEntry = {
  source: EventSource;
  refCount: number;
  callbacks: Set<(event: Record<string, unknown>) => void>;
  onConnectCallbacks: Set<() => void>;
  connectedListeners: Set<(connected: boolean) => void>;
  lastEvent: Record<string, unknown> | null;
  eventCount: number;
  connected: boolean;
};

const pool = new Map<string, PoolEntry>();

function getOrCreateEntry(roomId: string): PoolEntry {
  const existing = pool.get(roomId);
  if (existing) return existing;
  const source = new EventSource(`/api/realtime/${encodeURIComponent(roomId)}/events`);
  const entry: PoolEntry = {
    source,
    refCount: 0,
    callbacks: new Set(),
    onConnectCallbacks: new Set(),
    connectedListeners: new Set(),
    lastEvent: null,
    eventCount: 0,
    connected: false
  };
  source.onopen = () => {
    entry.connected = true;
    for (const cb of entry.onConnectCallbacks) cb();
    for (const listener of entry.connectedListeners) listener(true);
  };
  source.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as Record<string, unknown>;
      entry.lastEvent = parsed;
      entry.eventCount += 1;
      for (const cb of entry.callbacks) cb(parsed);
    } catch {
      /* ignore malformed events */
    }
  };
  source.onerror = () => {
    entry.connected = false;
    for (const listener of entry.connectedListeners) listener(false);
  };
  pool.set(roomId, entry);
  return entry;
}

export function subscribeToRoomEvents(
  roomId: string,
  opts?: { onConnect?: () => void }
): RealtimeRoomHandle {
  let eventCount = $state(0);
  let lastEvent = $state<Record<string, unknown> | null>(null);
  let connected = $state(false);

  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return {
      get eventCount() { return eventCount; },
      get lastEvent() { return lastEvent; },
      get connected() { return connected; },
      close() { /* no-op SSR */ }
    };
  }

  const entry = getOrCreateEntry(roomId);
  entry.refCount += 1;

  const messageCb = (event: Record<string, unknown>) => {
    lastEvent = event;
    eventCount += 1;
  };
  const connectedListener = (isConnected: boolean) => {
    connected = isConnected;
  };
  const onConnectCb = opts?.onConnect;
  entry.callbacks.add(messageCb);
  entry.connectedListeners.add(connectedListener);
  if (onConnectCb) entry.onConnectCallbacks.add(onConnectCb);

  // Seed local state from the pooled entry so late subscribers don't
  // miss the connection's current view.
  connected = entry.connected;
  if (entry.lastEvent) {
    lastEvent = entry.lastEvent;
    eventCount = entry.eventCount;
  }

  return {
    get eventCount() { return eventCount; },
    get lastEvent() { return lastEvent; },
    get connected() { return connected; },
    close() {
      const current = pool.get(roomId);
      if (!current) return;
      current.callbacks.delete(messageCb);
      current.connectedListeners.delete(connectedListener);
      if (onConnectCb) current.onConnectCallbacks.delete(onConnectCb);
      current.refCount -= 1;
      if (current.refCount <= 0) {
        current.source.close();
        pool.delete(roomId);
      }
    }
  };
}
