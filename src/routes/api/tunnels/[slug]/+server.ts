import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTunnelBySlug, updateTunnel, deleteTunnel } from '$lib/server/tunnelStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

function serialize(t: NonNullable<ReturnType<typeof getTunnelBySlug>>) {
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

export const GET: RequestHandler = async ({ request, params }) => {
  const tunnel = getTunnelBySlug(params.slug);
  if (!tunnel) throw error(404, 'Tunnel not found');
  requireChatRoomMutationAuth(tunnel.owner_room_id, request, null);
  return json({ tunnel: serialize(tunnel) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const tunnel = getTunnelBySlug(params.slug);
  if (!tunnel) throw error(404, 'Tunnel not found');

  const body = await request.json().catch(() => ({}));
  requireChatRoomMutationAuth(tunnel.owner_room_id, request, body);
  const updated = updateTunnel(params.slug, {
    title: body.title,
    public_url: body.public_url,
    local_url: body.local_url,
    allowed_room_ids: body.allowed_room_ids,
    access_required: body.access_required,
    status: body.status,
  });
  if (!updated) throw error(404, 'Tunnel not found');
  return json({ tunnel: serialize(updated) });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const tunnel = getTunnelBySlug(params.slug);
  if (!tunnel) throw error(404, 'Tunnel not found');
  requireChatRoomMutationAuth(tunnel.owner_room_id, request, null);
  deleteTunnel(params.slug);
  return json({ slug: params.slug });
};
