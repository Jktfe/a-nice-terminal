// Server-Sent Events stream for a remote MCP room.
//
// Auth: same per-room bearer token as POST /mcp/room/:id (Authorization
// header OR ?token= query). One token, two transports — revoke kills both.
//
// Why SSE rather than WS:
//   * Plain HTTP, no upgrade dance, traverses Cloudflare/Funnel cleanly.
//   * MCP's "streamable-http" transport variant already understands SSE.
//   * We have no client→server messages on this channel — everything posts
//     go through POST /mcp/room/:id. Half-duplex is the right shape.
//
// Implementation note: we piggyback on the existing ws-broadcast singleton
// by registering a fake WS-shaped client whose `send()` writes an SSE frame.
// This means `broadcast(roomId, msg)` from anywhere in the codebase fans
// out to SSE subscribers for free — no parallel pubsub plumbing.
//
// Frame shape:
//   event: ready          (once on connect)
//   data: {"room_id":"…","handle":"…"}
//
//   data: {"type":"message_added", …}     (on each broadcast)
//
//   : heartbeat                          (every 25s, comment frame so
//                                         intermediaries don't time out)

import type { RequestEvent } from '@sveltejs/kit';
import { resolveMcpContext } from '$lib/server/mcp-handler';
import { registerClient, deregisterClient } from '$lib/server/ws-broadcast';
import { registerStream, deregisterStream } from '$lib/server/mcp-streams';

const HEARTBEAT_MS = 25_000;

export function GET(event: RequestEvent<{ id: string }>) {
  const { params, request, url } = event;

  const ctx = resolveMcpContext(request, url, params.id);
  if (!ctx) {
    return new Response('Unauthorised\n', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const encoder = new TextEncoder();
  const key = Symbol(`sse:${params.id}:${ctx.tokenId}`);
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); }
        catch { /* stream closed under us — broadcast loop will drop next time */ }
      };

      const teardown = (reason: 'revoked' | 'shutdown' | 'cancel') => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        deregisterClient(key);
        deregisterStream(key);
        if (reason === 'revoked') {
          // Best-effort farewell frame so the client knows why we hung up
          // rather than treating it as a network blip and reconnecting.
          try {
            controller.enqueue(encoder.encode(`event: closed\ndata: ${JSON.stringify({ reason: 'revoked' })}\n\n`));
          } catch {}
        }
        try { controller.close(); } catch {}
      };

      // Register as a virtual WS client so broadcast(roomId, …) reaches us.
      // readyState 1 mirrors WS OPEN so the broadcast filter accepts us.
      registerClient(key, {
        sessionId: ctx.roomId,
        sessionIds: new Set([ctx.roomId]),
        handle: ctx.handle,
        handles: new Map([[ctx.roomId, ctx.handle]]),
        readyState: 1,
        send: (msg: string) => enqueue(`data: ${msg}\n\n`),
      });

      // Track the open stream so revokeInvite/revokeToken can close us.
      registerStream(key, {
        tokenId: ctx.tokenId,
        inviteId: ctx.inviteId,
        roomId: ctx.roomId,
        close: teardown,
      });

      // Initial handshake — lets the client confirm scope before any events arrive.
      enqueue('event: ready\n');
      enqueue(`data: ${JSON.stringify({ room_id: ctx.roomId, handle: ctx.handle, token_id: ctx.tokenId })}\n\n`);

      heartbeat = setInterval(() => enqueue(': heartbeat\n\n'), HEARTBEAT_MS);
    },

    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      deregisterClient(key);
      deregisterStream(key);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
