/**
 * eventBroadcast — globalThis-backed per-room SSE broadcaster for the
 * realtime layer (GAP-55 T2-A per realtime-layer-design-contract
 * 2026-05-14). Other server modules call broadcast() after a write
 * commits; SSE endpoint registers/unregisters subscribers on the same
 * globalThis singleton so dev-mode HMR doesn't double up.
 */

type Subscriber = ReadableStreamDefaultController<Uint8Array>;

type Globals = {
  __antEventBroadcast?: {
    subscribers: Map<string, Set<Subscriber>>;
    seq: Map<string, number>;
  };
};

function getStore(): {
  subscribers: Map<string, Set<Subscriber>>;
  seq: Map<string, number>;
} {
  const g = globalThis as unknown as Globals;
  if (!g.__antEventBroadcast)
    g.__antEventBroadcast = { subscribers: new Map(), seq: new Map() };
  return g.__antEventBroadcast;
}

// Per-room monotonic sequence counter (SSE consumer contract v0).
// In-memory only; resets on server restart. Consumers MUST treat
// seq going backwards as "server restarted, continue forward" rather
// than reordering — the consumer pattern's `lastSeq = event.seq`
// silently handles this. Per @claudev4 ratify (yz4clwzvbm 2026-05-23).
export function nextSeqForRoom(roomId: string): number {
  const store = getStore();
  const next = (store.seq.get(roomId) ?? 0) + 1;
  store.seq.set(roomId, next);
  return next;
}

export function currentSeqForRoom(roomId: string): number {
  return getStore().seq.get(roomId) ?? 0;
}

export function subscribeToRoom(roomId: string, controller: Subscriber): void {
  const { subscribers } = getStore();
  if (!subscribers.has(roomId)) subscribers.set(roomId, new Set());
  subscribers.get(roomId)!.add(controller);
}

export function unsubscribeFromRoom(roomId: string, controller: Subscriber): void {
  const { subscribers } = getStore();
  const roomSet = subscribers.get(roomId);
  if (!roomSet) return;
  roomSet.delete(controller);
  if (roomSet.size === 0) subscribers.delete(roomId);
}

export function broadcastToRoom(roomId: string, event: Record<string, unknown>): void {
  const { subscribers } = getStore();
  const roomSet = subscribers.get(roomId);
  // Mint a seq even with no subscribers so currentSeqForRoom() advances
  // — keeps the connect-frame's latest_seq honest about what's happened
  // in the room, not what subscribers happened to be online for.
  const seq = nextSeqForRoom(roomId);
  if (!roomSet || roomSet.size === 0) return;
  const eventWithSeq = { ...event, seq };
  // SSE `id:` header lets the browser EventSource set lastEventId so
  // auto-reconnect resumes with a Last-Event-ID header. Node consumers
  // read the inline `seq` field for the same purpose.
  const payload = `id: ${seq}\ndata: ${JSON.stringify(eventWithSeq)}\n\n`;
  const bytes = new TextEncoder().encode(payload);
  for (const controller of roomSet) {
    try {
      controller.enqueue(bytes);
    } catch {
      roomSet.delete(controller);
    }
  }
}

export function subscriberCountForRoom(roomId: string): number {
  return getStore().subscribers.get(roomId)?.size ?? 0;
}

/**
 * Long-poll bridge — wraps subscribeToRoom in a duck-typed controller
 * that forwards each enqueued payload through `onEvent` as the parsed
 * event object. Returns an unsubscribe handle. Used by routes that need
 * to await the next message in a set of rooms without exposing an
 * SSE stream (e.g. GET /api/me/mentions long-poll).
 *
 * Decoder is the inverse of broadcastToRoom's encoder: drops the leading
 * "data: " prefix, parses the JSON, and dispatches. We intentionally
 * round-trip through bytes (rather than fan out a typed listener path)
 * so the broadcaster stays a single code path — the existing SSE route
 * is the canonical consumer and adding a parallel listener registry
 * would invite drift.
 */
export function subscribeRoomEvents(
  roomId: string,
  onEvent: (event: Record<string, unknown>) => void
): () => void {
  const decoder = new TextDecoder();
  const controller: Subscriber = {
    enqueue(bytes: Uint8Array) {
      try {
        const text = decoder.decode(bytes);
        // Lines look like: "data: {...json...}\n\n". Strip the prefix
        // and trailing newlines. Heartbeat comments (": heartbeat") are
        // never broadcast via this path (they're emitted directly by
        // the SSE route), so we don't need to filter them here.
        const trimmed = text.replace(/^data:\s*/, '').trim();
        if (trimmed.length === 0) return;
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        onEvent(parsed);
      } catch {
        // Best-effort: a broadcaster payload that fails to parse means
        // a programming error elsewhere — we don't want to crash the
        // long-poll subscriber, so just swallow.
      }
    },
    // Stubs to satisfy the ReadableStreamDefaultController shape; the
    // broadcaster only ever calls .enqueue() in practice.
    close() {},
    error() {},
    desiredSize: 1,
    enqueueWithSizeAndOptions: undefined as unknown
  } as unknown as Subscriber;
  subscribeToRoom(roomId, controller);
  return () => unsubscribeFromRoom(roomId, controller);
}
