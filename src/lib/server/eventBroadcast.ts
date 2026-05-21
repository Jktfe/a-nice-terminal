/**
 * eventBroadcast — globalThis-backed per-room SSE broadcaster for the
 * realtime layer (GAP-55 T2-A per realtime-layer-design-contract
 * 2026-05-14). Other server modules call broadcast() after a write
 * commits; SSE endpoint registers/unregisters subscribers on the same
 * globalThis singleton so dev-mode HMR doesn't double up.
 */

type Subscriber = ReadableStreamDefaultController<Uint8Array>;

type Globals = {
  __antEventBroadcast?: { subscribers: Map<string, Set<Subscriber>> };
};

function getStore(): { subscribers: Map<string, Set<Subscriber>> } {
  const g = globalThis as unknown as Globals;
  if (!g.__antEventBroadcast) g.__antEventBroadcast = { subscribers: new Map() };
  return g.__antEventBroadcast;
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
  if (!roomSet || roomSet.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
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
