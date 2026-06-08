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

// Native EventSource auto-reconnects on TRANSIENT errors (readyState stays
// CONNECTING). But on a FATAL response — the 401/text-html the auth gate
// returns when the browser-session cookie lapses, or a non-event-stream
// served while :6174 restarts mid-stream — the browser sets readyState to
// CLOSED and gives up PERMANENTLY, silently freezing live updates until a
// manual refresh. That was the 2026-06-08 "I'm back to refreshing"
// regression: server restarts during recovery killed every live tab's
// stream and nothing re-opened it. We add an explicit close + re-open with
// capped exponential backoff whenever the source lands in CLOSED while still
// referenced, so a restart self-heals instead of going dark.
const REOPEN_BASE_MS = 1_000;
const REOPEN_MAX_MS = 30_000;

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
  onDisconnectCallbacks: Set<() => void>;
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
  // Explicit-reopen backoff (the fatal-CLOSED self-heal above). Timer is
  // non-null while a re-open is pending; delay grows per attempt and resets
  // to REOPEN_BASE_MS on a successful onopen.
  reopenTimer: ReturnType<typeof setTimeout> | null;
  reopenDelayMs: number;
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

// Schedule an explicit close + re-open after the source has landed in
// CLOSED (native retry has permanently given up). Capped exponential
// backoff; no-op if a reopen is already pending or nobody's listening.
function scheduleReopen(entry: PoolEntry, roomId: string): void {
  if (entry.reopenTimer !== null) return; // already pending
  if (entry.refCount <= 0) return; // no subscribers — close() handles teardown
  entry.reopenTimer = setTimeout(() => {
    entry.reopenTimer = null;
    if (entry.refCount <= 0) return;
    // Native retry may have recovered it in the meantime — don't churn.
    if (entry.source.readyState !== EventSource.CLOSED) return;
    entry.reopenDelayMs = Math.min(entry.reopenDelayMs * 2, REOPEN_MAX_MS);
    try {
      entry.source.close();
    } catch {
      /* already closed */
    }
    entry.source = new EventSource(`/api/realtime/${encodeURIComponent(roomId)}/events`);
    entry.connectionState = 'connecting';
    wireSource(entry, roomId);
  }, entry.reopenDelayMs);
}

// Wire the SSE handlers onto `entry.source`. Extracted from getOrCreateEntry
// so a backoff re-open or tab-foreground rebuild can re-wire a fresh source
// without tearing down the pool entry and its subscriber callbacks.
function wireSource(entry: PoolEntry, roomId: string): void {
  const source = entry.source;
  source.onopen = () => {
    entry.connected = true;
    entry.connectionState = 'connected';
    entry.firstFailedAtMs = null;
    entry.lastError = null;
    if (entry.unreachableTimer !== null) {
      clearTimeout(entry.unreachableTimer);
      entry.unreachableTimer = null;
    }
    // Stream re-established — reset the reopen backoff + cancel any pending reopen.
    entry.reopenDelayMs = REOPEN_BASE_MS;
    if (entry.reopenTimer !== null) {
      clearTimeout(entry.reopenTimer);
      entry.reopenTimer = null;
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
    // Native EventSource retry only runs while CONNECTING. A CLOSED source
    // means the browser gave up (fatal response) — force an explicit
    // backoff re-open so a server restart self-heals instead of going dark.
    if (entry.source.readyState === EventSource.CLOSED) {
      scheduleReopen(entry, roomId);
    }
    for (const cb of entry.onDisconnectCallbacks) cb();
    for (const listener of entry.connectedListeners) listener(false);
    notifyConnectionStateListeners(entry);
  };
}

// MOBILE AUTOREFRESH FIX (2026-06-08, @c4): iOS Safari (and aggressive
// desktop tab-throttling) suspends or kills a backgrounded EventSource;
// native auto-reconnect frequently does NOT resume when the tab returns to
// the foreground, leaving the room view silently stale — the user comes
// back to a dead socket and "autorefresh stopped working, I missed all the
// messages". Register ONE document-level visibilitychange listener that,
// on return-to-foreground, rebuilds any dead/errored socket and forces a
// catch-up invalidate (via onConnect) so the view re-syncs immediately.
let foregroundReconnectRegistered = false;
function ensureForegroundReconnect(): void {
  if (foregroundReconnectRegistered) return;
  if (typeof document === 'undefined') return;
  foregroundReconnectRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const [roomId, entry] of pool) {
      const dead =
        entry.source.readyState === EventSource.CLOSED ||
        entry.connectionState === 'disconnected' ||
        entry.connectionState === 'unreachable';
      if (dead) {
        // Rebuild the socket in place; its onopen fires onConnect →
        // invalidateAll, so the view catches up on everything missed.
        try { entry.source.close(); } catch { /* already closed */ }
        if (entry.unreachableTimer !== null) {
          clearTimeout(entry.unreachableTimer);
          entry.unreachableTimer = null;
        }
        if (entry.reopenTimer !== null) {
          clearTimeout(entry.reopenTimer);
          entry.reopenTimer = null;
        }
        entry.connected = false;
        entry.connectionState = 'connecting';
        entry.firstFailedAtMs = null;
        entry.lastError = null;
        entry.reopenDelayMs = REOPEN_BASE_MS;
        entry.source = new EventSource(`/api/realtime/${encodeURIComponent(roomId)}/events`);
        wireSource(entry, roomId);
        notifyConnectionStateListeners(entry);
      } else {
        // Socket believed alive but events may have been throttled/dropped
        // while backgrounded — force a one-shot catch-up so the list re-syncs.
        for (const cb of entry.onConnectCallbacks) cb();
      }
    }
  });
}

function getOrCreateEntry(roomId: string): PoolEntry {
  const existing = pool.get(roomId);
  if (existing) return existing;
  ensureForegroundReconnect();
  const entry: PoolEntry = {
    source: new EventSource(`/api/realtime/${encodeURIComponent(roomId)}/events`),
    refCount: 0,
    callbacks: new Set(),
    onConnectCallbacks: new Set(),
    onDisconnectCallbacks: new Set(),
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
    unreachableTimer: null,
    reopenTimer: null,
    reopenDelayMs: REOPEN_BASE_MS
  };
  wireSource(entry, roomId);
  pool.set(roomId, entry);
  return entry;
}

export function subscribeToRoomEvents(
  roomId: string,
  opts?: { onConnect?: () => void; onDisconnect?: () => void }
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
  const onDisconnectCb = opts?.onDisconnect;
  entry.callbacks.add(messageCb);
  entry.connectedListeners.add(connectedListener);
  if (onConnectCb) entry.onConnectCallbacks.add(onConnectCb);
  if (onDisconnectCb) entry.onDisconnectCallbacks.add(onDisconnectCb);

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
      if (onDisconnectCb) current.onDisconnectCallbacks.delete(onDisconnectCb);
      current.refCount -= 1;
      if (current.refCount <= 0) {
        if (current.unreachableTimer !== null) clearTimeout(current.unreachableTimer);
        if (current.reopenTimer !== null) clearTimeout(current.reopenTimer);
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
        if (current.reopenTimer !== null) clearTimeout(current.reopenTimer);
        current.source.close();
        pool.delete(roomId);
      }
    }
  };
}
