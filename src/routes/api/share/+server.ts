import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { createShareLink, listShareLinksForRoom } from '$lib/server/shareLinkStore';

export const GET: RequestHandler = async ({ url }: { url: URL }) => {
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  const links = listShareLinksForRoom(roomId);
  return json({ links });
};

export const POST: RequestHandler = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const roomId = body.roomId;
  if (!roomId || typeof roomId !== 'string') throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');

  const link = createShareLink({
    room_id: roomId,
    title: body.title ?? null,
    scope: body.scope ?? 'room',
    created_by: body.createdBy ?? null,
    expires_at_ms: body.expiresAtMs ?? null,
  });

  return json({ link }, { status: 201 });
};
