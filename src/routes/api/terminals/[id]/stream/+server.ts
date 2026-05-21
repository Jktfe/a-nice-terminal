/**
 * GET /api/terminals/[id]/stream — SSE stream of terminal output for one
 * session. Subscribes to the v3 pty-daemon's `output` events and forwards
 * the bytes for the matching sessionId. Per terminals-backend-design-contract
 * 2026-05-14 Q3 (SSE reuse of GAP-55 infrastructure shape).
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { subscribeOutput } from '$lib/server/ptyClient';
import {
  capturePaneScrollback,
  tmuxPaneCurrentPath,
  tmuxTargetForSession
} from '$lib/server/tmuxPaneSnapshot';

const HEARTBEAT_INTERVAL_MS = 25_000;

export const GET: RequestHandler = ({ params }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));
      const target = tmuxTargetForSession(sessionId);
      const cwd = tmuxPaneCurrentPath(target);
      const scrollback = capturePaneScrollback(target);
      if (scrollback.length > 0 || cwd) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ data: scrollback, cwd })}\n\n`));
      }
      unsubscribe = subscribeOutput((sid, data) => {
        if (sid !== sessionId) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ data })}\n\n`));
        } catch {
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
