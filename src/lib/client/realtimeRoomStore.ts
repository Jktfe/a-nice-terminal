/**
 * realtimeRoomStore — browser-side companion to `realtimeRoomConsumer.ts`
 * (server-side SSE consumer contract v0, docs/contracts/sse-consumer-contract-v0.md).
 *
 * The server-side consumer module exposed an `onConnectionState` callback
 * with `{ state, lastSeq, latestSeq, cause }`. The browser EventSource has
 * its own auto-reconnect semantics but doesn't surface the same structured
 * state to consumers — this store wraps native EventSource and exposes the
 * same shape via Svelte 5 runes so component code can render the finish-
 * layer UX (offline indicator / retry feedback / catching-up / caught-up /
 * unreachable) without each component re-implementing the state machine.
 *
 * Slice 3 of the SSE story per overnight brief 2026-05-24, JWPK-named claim
 * for @claudev4 in Silent heroes room yz4clwzvbm 2026-05-23.
 *
 * ## Relationship to `$lib/stores/realtimeRoom.svelte.ts`
 *
 * The existing `realtimeRoom.svelte.ts` is a refcounted shared-pool
 * EventSource consumer that exposes `{ eventCount, lastEvent, connected }`
 * — minimal connection-state surface, designed for callers that just need
 * to know "did anything happen" and "is the pipe up". This store offers a
 * RICHER surface (catching-up / caught-up / retry-countdown / unreachable)
 * intended for the finish-layer UX. For now the two live in parallel; the
 * v1 consolidation is to extend the existing pool to expose this store's
 * state shape so callers get one EventSource per room with both surfaces
 * available. Avoid using both in the same page until consolidated.
 *
 * ## Event-type filtering (from @speedyclaude evidence 2026-05-23)
 *
 * The room SSE stream includes multiple event types. Notably `agent_activity`
 * fires on every agent presence / mouse-move-shaped ping AND bumps seq. The
 * STORE'S connection state stays at 'caught-up' for these (lastSeq and
 * latestSeq advance together, no catching-up flicker). But callers' onEvent
 * receives EVERY event — filter by `event.type` for any "new message"-style
 * affordance (e.g. only react to `message_added`, ignore `agent_activity`).
 */

export type RealtimeConnectionState =
  | 'idle'           // never started
  | 'connecting'     // initial connect in flight
  | 'connected'      // SSE handshake successful, awaiting first event
  | 'catching-up'    // connected but lastSeq < latestSeq (backfill-shaped lag)
  | 'caught-up'      // lastSeq === latestSeq AND we've seen at least one event
  | 'disconnected'   // stream ended, reconnecting
  | 'unreachable';   // > 30s of failed connect attempts

export type RealtimeRoomStoreState = {
  state: RealtimeConnectionState;
  lastSeq: number;
  latestSeq: number;
  lastError: string | null;
  retryInMs: number | null;
  firstFailedAtMs: number | null;
};

export type RealtimeRoomEvent = {
  type: string;
  seq?: number;
  latest_seq?: number;
  [k: string]: unknown;
};

export type RealtimeRoomStoreOptions = {
  roomId: string;
  baseUrl?: string;                        // defaults to '' (same origin)
  onEvent?: (event: RealtimeRoomEvent) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  unreachableAfterMs?: number;
  // Override for tests; defaults to globalThis.EventSource.
  eventSourceCtor?: typeof EventSource;
};

const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_UNREACHABLE_AFTER_MS = 30000;

export type RealtimeRoomStore = {
  /** Reactive Svelte 5 $state-bound snapshot. */
  readonly value: RealtimeRoomStoreState;
  /** Stop the consumer + tear down. */
  close: () => void;
};

/**
 * Create a reactive store that mirrors `realtimeRoomConsumer` semantics for
 * browsers. Components subscribe via the returned object's `.value`
 * (Svelte 5 reactive proxy).
 */
export function createRealtimeRoomStore(options: RealtimeRoomStoreOptions): RealtimeRoomStore {
  // SSR safety + node fallback: when no EventSource is reachable
  // (server-side render, jsdom-less test env without injection), return
  // a static idle state and a no-op close so callers don't need to
  // branch. Tests can inject `eventSourceCtor` to opt into the live
  // shape; production browsers have `globalThis.EventSource` natively.
  const InjectedCtor = options.eventSourceCtor;
  const GlobalCtor = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  const EventSourceCtor = InjectedCtor ?? GlobalCtor;
  if (!EventSourceCtor) {
    const idleSnapshot: RealtimeRoomStoreState = {
      state: 'idle',
      lastSeq: 0,
      latestSeq: 0,
      lastError: null,
      retryInMs: null,
      firstFailedAtMs: null
    };
    return { value: idleSnapshot, close: () => {} };
  }
  const EventSourceImpl: typeof EventSource = EventSourceCtor;

  const initialBackoff = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoff = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const unreachableAfter = options.unreachableAfterMs ?? DEFAULT_UNREACHABLE_AFTER_MS;
  const base = options.baseUrl ?? '';

  // The .value object is the same reference throughout the lifetime of the
  // store — Svelte 5's $state-bound assignment lifts mutations into
  // reactivity, so we just mutate fields in place. Consumers can either
  // read `store.value.state` directly or wrap in $derived.
  const snapshot: RealtimeRoomStoreState = {
    state: 'connecting',
    lastSeq: 0,
    latestSeq: 0,
    lastError: null,
    retryInMs: null,
    firstFailedAtMs: null
  };

  let currentBackoff = initialBackoff;
  let activeSource: EventSource | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffCountdown: ReturnType<typeof setInterval> | null = null;
  let retryDeadlineMs: number | null = null;

  function clearRetryTimers() {
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
    if (backoffCountdown !== null) { clearInterval(backoffCountdown); backoffCountdown = null; }
    retryDeadlineMs = null;
    snapshot.retryInMs = null;
  }

  function startBackoffCountdown(delayMs: number) {
    retryDeadlineMs = Date.now() + delayMs;
    snapshot.retryInMs = delayMs;
    // Update retryInMs every 250ms so the UX can render a live countdown.
    backoffCountdown = setInterval(() => {
      if (retryDeadlineMs === null) return;
      const remaining = Math.max(0, retryDeadlineMs - Date.now());
      snapshot.retryInMs = remaining;
      if (remaining === 0 && backoffCountdown !== null) {
        clearInterval(backoffCountdown);
        backoffCountdown = null;
      }
    }, 250);
  }

  function refreshDerivedState() {
    // Catching-up vs caught-up derivation — only matters once we've
    // observed a latestSeq from the synthetic connected frame.
    if (snapshot.state === 'connected' || snapshot.state === 'catching-up' || snapshot.state === 'caught-up') {
      if (snapshot.latestSeq > 0 && snapshot.lastSeq >= snapshot.latestSeq) {
        snapshot.state = 'caught-up';
      } else if (snapshot.latestSeq > 0 && snapshot.lastSeq < snapshot.latestSeq) {
        snapshot.state = 'catching-up';
      }
    }
  }

  function openConnection() {
    if (closed) return;
    snapshot.state = 'connecting';
    snapshot.lastError = null;

    const url = `${base}/api/realtime/${encodeURIComponent(options.roomId)}/events`;
    let source: EventSource;
    try {
      source = new EventSourceImpl(url);
    } catch (cause) {
      snapshot.lastError = cause instanceof Error ? cause.message : String(cause);
      handleConnectionFailure();
      return;
    }
    activeSource = source;

    source.onopen = () => {
      snapshot.state = 'connected';
      snapshot.lastError = null;
      snapshot.firstFailedAtMs = null;
      currentBackoff = initialBackoff;
      clearRetryTimers();
    };

    source.onmessage = (ev: MessageEvent) => {
      let event: RealtimeRoomEvent;
      try {
        event = JSON.parse(ev.data) as RealtimeRoomEvent;
      } catch {
        return; // malformed frame
      }
      if (typeof event.seq === 'number') snapshot.lastSeq = event.seq;
      if (event.type === 'connected' && typeof event.latest_seq === 'number') {
        snapshot.latestSeq = event.latest_seq;
        // If we connected with no prior lastSeq, seed it to the latest so
        // the UX skips the "catching-up" flicker on the initial connect.
        if (snapshot.lastSeq === 0) snapshot.lastSeq = event.latest_seq;
      } else if (typeof event.seq === 'number' && event.seq > snapshot.latestSeq) {
        // Live event beyond the snapshot — bump latestSeq to keep the
        // caught-up derivation honest.
        snapshot.latestSeq = event.seq;
      }
      refreshDerivedState();
      if (options.onEvent) {
        try { options.onEvent(event); } catch { /* consumer crash must not break the loop */ }
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects, but it goes into a tight retry loop
      // without exposing structured state. We tear it down + run our own
      // backoff so the UX can render retry feedback.
      handleConnectionFailure();
    };
  }

  function handleConnectionFailure() {
    if (closed) return;
    if (activeSource) {
      activeSource.close();
      activeSource = null;
    }
    snapshot.state = 'disconnected';
    if (snapshot.firstFailedAtMs === null) snapshot.firstFailedAtMs = Date.now();

    const failedFor = Date.now() - (snapshot.firstFailedAtMs ?? Date.now());
    if (failedFor >= unreachableAfter) {
      snapshot.state = 'unreachable';
    }

    const delay = currentBackoff;
    currentBackoff = Math.min(currentBackoff * 2, maxBackoff);
    startBackoffCountdown(delay);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      openConnection();
    }, delay);
  }

  // Kick off the initial connect on the next microtask so consumers can
  // attach reactive subscriptions before any state transition fires.
  queueMicrotask(openConnection);

  return {
    get value() { return snapshot; },
    close() {
      closed = true;
      clearRetryTimers();
      if (activeSource) {
        activeSource.close();
        activeSource = null;
      }
      snapshot.state = 'idle';
    }
  };
}
