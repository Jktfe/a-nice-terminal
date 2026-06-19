import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { createShareLink, listShareLinksForRoom } from '$lib/server/shareLinkStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = async ({ request, url }: { request: Request; url: URL }) => {
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  requireChatRoomMutationAuth(roomId, request, null);
  const links = listShareLinksForRoom(roomId);
  return json({ links });
};

export const POST: RequestHandler = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const roomId = body.roomId;
  if (!roomId || typeof roomId !== 'string') throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  const actor = requireChatRoomMutationAuth(roomId, request, body);

  const link = createShareLink({
    room_id: roomId,
    title: body.title ?? null,
    scope: body.scope ?? 'room',
    created_by: actor.handle,
    expires_at_ms: body.expiresAtMs ?? null,
  });

  return json({ link }, { status: 201 });
};
