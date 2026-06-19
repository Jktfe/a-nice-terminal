import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listTunnelsForRoom, createTunnel, getTunnelBySlug } from '$lib/server/tunnelStore';
import type { Tunnel } from '$lib/server/tunnelStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

function serialize(t: Tunnel) {
  return {
    slug: t.slug,
    title: t.title,
    public_url: t.public_url,
    local_url: t.local_url,
    owner_room_id: t.owner_room_id,
    allowed_room_ids: t.allowed_room_ids,
    access_required: t.access_required,
    status: t.status,
    created_at_ms: t.created_at_ms,
    updated_at_ms: t.updated_at_ms,
  };
}

export const GET: RequestHandler = async ({ request, url }) => {
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  requireChatRoomMutationAuth(roomId, request, null);
  const tunnels = listTunnelsForRoom(roomId);
  return json({ tunnels: tunnels.map(serialize) });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const roomId = body.roomId;
  if (!roomId || typeof roomId !== 'string') throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  requireChatRoomMutationAuth(roomId, request, body);

  const slug = body.slug;
  if (!slug || typeof slug !== 'string') throw error(400, 'slug required');
  if (getTunnelBySlug(slug)) throw error(409, 'Tunnel slug already exists');

  const publicUrl = body.public_url;
  if (!publicUrl || typeof publicUrl !== 'string') throw error(400, 'public_url required');

  const tunnel = createTunnel({
    slug,
    title: body.title ?? null,
    public_url: publicUrl,
    local_url: body.local_url ?? null,
    owner_room_id: roomId,
    allowed_room_ids: Array.isArray(body.allowed_room_ids) ? body.allowed_room_ids : [],
    access_required: Boolean(body.access_required),
    status: 'linked',
  });

  return json({ tunnel: serialize(tunnel) }, { status: 201 });
};
