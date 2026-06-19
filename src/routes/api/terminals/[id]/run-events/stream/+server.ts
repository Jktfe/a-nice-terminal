/**
 * GET /api/terminals/[id]/run-events/stream?kinds=...&sources=...
 *   SSE live-tail of CLASSIFIED run-events for one terminal. T2c-impl-1
 *   delta-1: routes through terminalEventBroadcast (the same classifier
 *   output that persistence consumes) — NOT raw daemon bytes — so
 *   ?kinds=message etc filters land correctly. ANT v4 uses source filters
 *   so transcript/interactive events render without PTY classifier noise.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import { subscribeTerminalEvents } from '$lib/server/terminalEventBroadcast';

const HEARTBEAT_INTERVAL_MS = 25_000;

export const GET: RequestHandler = ({ params, request, url }) => {
  requireOperatorLikeAuth(request);
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const kindsParam = url.searchParams.get('kinds');
  const allowedKinds: Set<string> | null = kindsParam !== null && kindsParam.length > 0
    ? new Set(kindsParam.split(',').map((s) => s.trim()).filter((s) => s.length > 0))
    : null;
  const sourcesParam = url.searchParams.get('sources');
  const allowedSources: Set<string> | null = sourcesParam !== null && sourcesParam.length > 0
    ? new Set(sourcesParam.split(',').map((s) => s.trim()).filter((s) => s.length > 0))
    : null;

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));
      unsubscribe = subscribeTerminalEvents((sid, event) => {
        if (sid !== sessionId) return;
        if (allowedKinds && !allowedKinds.has(event.kind)) return;
        if (allowedSources && !allowedSources.has(event.source)) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch {
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
        }
      });
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); }
        catch { if (heartbeat) clearInterval(heartbeat); }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
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
