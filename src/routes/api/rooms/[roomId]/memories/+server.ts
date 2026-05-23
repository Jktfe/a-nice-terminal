import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { listRoomMemories, addRoomMemory } from '$lib/server/roomMemoryStore';

export const GET: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);
  const memories = listRoomMemories(roomId);
  return json({ roomId, memories });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId required');
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  requireChatRoomMutationAuth(roomId, request, payload);
  const title = typeof payload.title === 'string' ? payload.title : 'Untitled';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tags = Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [];

  const memory = addRoomMemory(title, body, [roomId], tags);
  return json({ memory }, { status: 201 });
};
