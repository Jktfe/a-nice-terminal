import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById, updateRoomContract } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const POST: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  requireChatRoomMutationAuth(roomId, request, payload);

  const contractId = typeof payload.contractId === 'string' ? payload.contractId : null;
  updateRoomContract(roomId, contractId);

  return json({ ok: true, roomId, contractId });
};
