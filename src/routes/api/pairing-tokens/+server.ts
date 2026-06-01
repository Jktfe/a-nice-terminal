import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { createPairingToken, listPairingTokensForRoom } from '$lib/server/pairingTokenStore';

function serialize(t: any) {
  return {
    token: t.token,
    room_id: t.room_id,
    server_url: t.server_url,
    device_name: t.device_name,
    created_by: t.created_by,
    created_at_ms: t.created_at_ms,
    expires_at_ms: t.expires_at_ms,
    consumed_at_ms: t.consumed_at_ms,
    consumed_by_device: t.consumed_by_device,
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');
  const tokens = listPairingTokensForRoom(roomId);
  return json({ tokens: tokens.map(serialize) });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const roomId = body.roomId;
  if (!roomId || typeof roomId !== 'string') throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');

  const serverUrl = body.serverUrl || process.env.ANT_SERVER_URL || 'http://localhost:6174';
  const apiKey = body.apiKey || process.env.ANT_API_KEY || '';
  if (!apiKey) throw error(400, 'apiKey required');

  const token = createPairingToken({
    room_id: roomId,
    server_url: serverUrl,
    api_key: apiKey,
    device_name: body.deviceName ?? null,
    created_by: body.createdBy ?? null,
    expires_at_ms: body.expiresAtMs ?? nowPlusHours(24),
  });

  return json({ token: serialize(token) }, { status: 201 });
};

function nowPlusHours(h: number): number {
  return Date.now() + h * 60 * 60 * 1000;
}
