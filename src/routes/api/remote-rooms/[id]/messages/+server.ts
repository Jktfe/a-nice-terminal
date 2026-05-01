// Proxies message GET (initial backfill) and POST (compose) to the remote ANT
// server hosting the room. Token stays server-side; browser never sees it.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getRemoteRoom } from '$lib/server/remote-rooms';
import { assertNotRoomScoped } from '$lib/server/room-scope';
import { insecureFetch } from '$lib/server/insecure-fetch';

export async function GET(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const room = getRemoteRoom(event.params.id);
  if (!room) return json({ error: 'remote room not found' }, { status: 404 });

  const remoteUrl = new URL(`${room.server_url}/api/sessions/${room.room_id}/messages`);
  for (const [k, v] of event.url.searchParams) remoteUrl.searchParams.set(k, v);

  const upstream = await insecureFetch(remoteUrl.toString(), {
    headers: { 'Authorization': `Bearer ${room.token}` },
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const room = getRemoteRoom(event.params.id);
  if (!room) return json({ error: 'remote room not found' }, { status: 404 });

  const body = await event.request.text();
  const upstream = await insecureFetch(`${room.server_url}/api/sessions/${room.room_id}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${room.token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  const respBody = await upstream.text();
  return new Response(respBody, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}
