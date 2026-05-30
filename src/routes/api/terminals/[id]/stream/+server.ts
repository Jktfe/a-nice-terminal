/**
 * GET /api/terminals/[id]/stream — SSE stream of terminal output for one
 * session. Subscribes to the v3 pty-daemon's `output` events and forwards
 * the bytes for the matching sessionId. Per terminals-backend-design-contract
 * 2026-05-14 Q3 (SSE reuse of GAP-55 infrastructure shape).
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { subscribeOutput, subscribeReset } from '$lib/server/ptyClient';
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
  let unsubscribeReset: (() => void) | null = null;
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
      const teardown = () => {
        unsubscribe?.();
        unsubscribeReset?.();
        if (heartbeat) clearInterval(heartbeat);
      };
      unsubscribe = subscribeOutput((sid, data) => {
        if (sid !== sessionId) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ data })}\n\n`));
        } catch {
          teardown();
        }
      });
      // On truncation/rotation the live offset reset means the client's xterm
      // now holds stale bytes from the old file. Re-capture the CURRENT pane
      // (what you'd see if you attached now) and push it with reset:true so
      // the client clears before repainting — the live tail resumes from the
      // new file's end, so no bytes are double-printed.
      unsubscribeReset = subscribeReset((sid) => {
        if (sid !== sessionId) return;
        try {
          const freshTarget = tmuxTargetForSession(sessionId);
          const freshScrollback = capturePaneScrollback(freshTarget);
          const freshCwd = tmuxPaneCurrentPath(freshTarget);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ data: freshScrollback, cwd: freshCwd, reset: true })}\n\n`));
        } catch {
          teardown();
        }
      });
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); }
        catch { if (heartbeat) clearInterval(heartbeat); }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      unsubscribe?.();
      unsubscribeReset?.();
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
