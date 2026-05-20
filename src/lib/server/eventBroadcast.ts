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
