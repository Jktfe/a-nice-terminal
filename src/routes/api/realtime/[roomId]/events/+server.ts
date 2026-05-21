/**
 * GET /api/realtime/[roomId]/events — Server-Sent Events stream for one
 * room. Per realtime-layer-design-contract 2026-05-14 (T2-A SSE shape).
 * Client connects via EventSource; server enqueues events when other
 * routes call broadcastToRoom(roomId, ...).
 *
 * Connection lifecycle:
 *   - start(): subscribe controller to the room
 *   - cancel(): unsubscribe (client disconnected or page nav)
 *   - heartbeat: 25s comment ping keeps proxies / browsers happy
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { subscribeToRoom, unsubscribeFromRoom } from '$lib/server/eventBroadcast';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_LINE = ': heartbeat\n\n';

export const GET: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'room not found');
  await requireChatRoomReadAccess(request, room);

  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscribeToRoom(roomId, controller);
      // Initial comment so the connection is fully established + the
      // browser fires `open` before any real event.
      controller.enqueue(new TextEncoder().encode(': connected\n\n'));
      heartbeatHandle = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(HEARTBEAT_LINE));
        } catch {
          if (heartbeatHandle) clearInterval(heartbeatHandle);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel(controller) {
      if (heartbeatHandle) clearInterval(heartbeatHandle);
      unsubscribeFromRoom(roomId, controller as ReadableStreamDefaultController<Uint8Array>);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
};
