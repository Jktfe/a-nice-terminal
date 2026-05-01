// Proxies the remote ANT server's SSE stream down to the local browser.
// Token via ?token= query upstream — same auth shape the remote /mcp/room
// stream already accepts. Body is a passthrough ReadableStream.

import type { RequestEvent } from '@sveltejs/kit';
import { getRemoteRoom } from '$lib/server/remote-rooms';
import { assertNotRoomScoped } from '$lib/server/room-scope';
import { insecureFetch, type InsecureResponse } from '$lib/server/insecure-fetch';

export async function GET(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const room = getRemoteRoom(event.params.id);
  if (!room) {
    return new Response('remote room not found\n', { status: 404 });
  }

  const upstreamUrl = new URL(`${room.server_url}/mcp/room/${room.room_id}/stream`);
  upstreamUrl.searchParams.set('token', room.token);

  let upstream: InsecureResponse;
  try {
    upstream = await insecureFetch(upstreamUrl.toString(), {
      headers: { Accept: 'text/event-stream' },
    });
  } catch (err: any) {
    return new Response(`upstream fetch failed: ${err?.message || err}\n`, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text();
    return new Response(`upstream ${upstream.status}: ${body}`, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
