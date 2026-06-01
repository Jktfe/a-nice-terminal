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
 *
 * SSE finish-layer consolidation (Silent heroes 2026-05-24): the pool
 * entry now tracks the richer connection-state surface that lives
 * separately in `$lib/client/realtimeRoomStore.ts`. Single EventSource
 * per room, two reactive views — `subscribeToRoomEvents` (legacy:
 * eventCount/lastEvent/connected) and `subscribeRoomConnectionState`
 * (state/lastSeq/latestSeq for the RealtimeStatusIndicator). Both share
 * the same pool entry so the HTTP/1.1-cap-aware refcounted design holds.
 */

export type RealtimeRoomHandle = {
  readonly eventCount: number;
  readonly lastEvent: Record<string, unknown> | null;
  readonly connected: boolean;
  close: () => void;
};

export type RealtimeConnectionState =
  | 'idle'           // never started
  | 'connecting'     // initial connect in flight
  | 'connected'      // SSE handshake successful, awaiting first event
  | 'catching-up'    // lastSeq < latestSeq — replaying after reconnect
  | 'caught-up'      // lastSeq === latestSeq AND we've observed at least one event
  | 'disconnected'   // stream errored, native auto-reconnect in flight
  | 'unreachable';   // > 30s of failed connect attempts

export type RealtimeRoomConnectionSnapshot = {
  state: RealtimeConnectionState;
  lastSeq: number;
  latestSeq: number;
  lastError: string | null;
  retryInMs: number | null;
  firstFailedAtMs: number | null;
};

// Shape kept compatible with the RealtimeRoomStore the
// RealtimeStatusIndicator was originally written against (deleted from
// the v0 lib in this consolidation, but the component contract holds).
export type RealtimeRoomStore = {
  readonly value: RealtimeRoomConnectionSnapshot;
  close: () => void;
};

const UNREACHABLE_AFTER_MS = 30_000;

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
  // Slice 4 follow-up consolidation: richer state for the finish-layer
  // status surface. Listener set is separate so the legacy
  // `connectedListeners` doesn't have to know about the richer states.
  connectionStateListeners: Set<(snapshot: RealtimeRoomConnectionSnapshot) => void>;
  lastEvent: Record<string, unknown> | null;
  eventCount: number;
  connected: boolean;
  // Richer connection-state tracking:
  connectionState: RealtimeConnectionState;
  lastSeq: number;
  latestSeq: number;
  lastError: string | null;
  firstFailedAtMs: number | null;
  unreachableTimer: ReturnType<typeof setTimeout> | null;
};

const pool = new Map<string, PoolEntry>();

function snapshotOf(entry: PoolEntry): RealtimeRoomConnectionSnapshot {
  return {
    state: entry.connectionState,
    lastSeq: entry.lastSeq,
    latestSeq: entry.latestSeq,
    lastError: entry.lastError,
    retryInMs: null, // native EventSource manages its own reconnect cadence
    firstFailedAtMs: entry.firstFailedAtMs
  };
}

function notifyConnectionStateListeners(entry: PoolEntry): void {
  if (entry.connectionStateListeners.size === 0) return;
  const snap = snapshotOf(entry);
  for (const listener of entry.connectionStateListeners) listener(snap);
}

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
    connectionStateListeners: new Set(),
    lastEvent: null,
    eventCount: 0,
    connected: false,
    connectionState: 'connecting',
    lastSeq: 0,
    latestSeq: 0,
    lastError: null,
    firstFailedAtMs: null,
    unreachableTimer: null
  };
  source.onopen = () => {
    entry.connected = true;
    entry.connectionState = 'connected';
    entry.firstFailedAtMs = null;
    entry.lastError = null;
    if (entry.unreachableTimer !== null) {
      clearTimeout(entry.unreachableTimer);
      entry.unreachableTimer = null;
    }
    for (const cb of entry.onConnectCallbacks) cb();
    for (const listener of entry.connectedListeners) listener(true);
    notifyConnectionStateListeners(entry);
  };
  source.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as Record<string, unknown>;
      entry.lastEvent = parsed;
      entry.eventCount += 1;
      // Track per-room sequence (SSE consumer contract v0). `seq` is
      // attached by broadcastToRoom on every event; the synthetic
      // `connected` frame on (re)connect also carries `latest_seq`.
      const seqValue = typeof parsed.seq === 'number' ? parsed.seq : null;
      if (seqValue !== null) entry.lastSeq = seqValue;
      if (parsed.type === 'connected' && typeof parsed.latest_seq === 'number') {
        entry.latestSeq = parsed.latest_seq;
        // Seed lastSeq to latestSeq on first connect so the UX skips a
        // spurious "catching-up" flicker before any live event has arrived.
        if (entry.lastSeq === 0) entry.lastSeq = parsed.latest_seq;
      } else if (seqValue !== null && seqValue > entry.latestSeq) {
        // Live event beyond the snapshot — bump latestSeq so the
        // caught-up derivation stays honest.
        entry.latestSeq = seqValue;
      }
      // Derive catching-up vs caught-up. Only meaningful once we've seen
      // a latest_seq from either the connected frame or any live event.
      if (entry.latestSeq > 0) {
        entry.connectionState = entry.lastSeq < entry.latestSeq ? 'catching-up' : 'caught-up';
      }
      for (const cb of entry.callbacks) cb(parsed);
      notifyConnectionStateListeners(entry);
    } catch {
      /* ignore malformed events */
    }
  };
  source.onerror = () => {
    entry.connected = false;
    entry.connectionState = 'disconnected';
    if (entry.firstFailedAtMs === null) entry.firstFailedAtMs = Date.now();
    entry.lastError = 'EventSource transport error';
    // After UNREACHABLE_AFTER_MS without a successful onopen, escalate
    // to 'unreachable' so the UX can show a manual-retry CTA.
    if (entry.unreachableTimer === null) {
      entry.unreachableTimer = setTimeout(() => {
        if (entry.connectionState === 'disconnected') {
          entry.connectionState = 'unreachable';
          notifyConnectionStateListeners(entry);
        }
      }, UNREACHABLE_AFTER_MS);
    }
    for (const listener of entry.connectedListeners) listener(false);
    notifyConnectionStateListeners(entry);
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
        if (current.unreachableTimer !== null) clearTimeout(current.unreachableTimer);
        current.source.close();
        pool.delete(roomId);
      }
    }
  };
}

/**
 * SSE finish-layer subscription — returns the richer connection-state
 * surface (state machine, lastSeq, latestSeq) for the
 * RealtimeStatusIndicator. Shares the same EventSource as
 * `subscribeToRoomEvents` via the pool, so a page can subscribe to both
 * surfaces without doubling the SSE socket cost.
 *
 * SSR-safe: when EventSource is missing (server-side render or test env
 * without injection), returns a static `idle` snapshot.
 */
export function subscribeRoomConnectionState(roomId: string): RealtimeRoomStore {
  let snapshot = $state<RealtimeRoomConnectionSnapshot>({
    state: 'idle',
    lastSeq: 0,
    latestSeq: 0,
    lastError: null,
    retryInMs: null,
    firstFailedAtMs: null
  });

  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return {
      get value() { return snapshot; },
      close() { /* no-op SSR */ }
    };
  }

  const entry = getOrCreateEntry(roomId);
  entry.refCount += 1;

  // Seed from the pool's current view so a late subscriber doesn't see
  // 'idle' for a connection that's already established.
  snapshot = snapshotOf(entry);

  const listener = (snap: RealtimeRoomConnectionSnapshot) => {
    snapshot = snap;
  };
  entry.connectionStateListeners.add(listener);

  return {
    get value() { return snapshot; },
    close() {
      const current = pool.get(roomId);
      if (!current) return;
      current.connectionStateListeners.delete(listener);
      current.refCount -= 1;
      if (current.refCount <= 0) {
        if (current.unreachableTimer !== null) clearTimeout(current.unreachableTimer);
        current.source.close();
        pool.delete(roomId);
      }
    }
  };
}
