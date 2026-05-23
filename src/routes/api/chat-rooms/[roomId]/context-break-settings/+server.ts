import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  getContextBreakEnforcement,
  isContextBreakEnforcement,
  setContextBreakEnforcement
} from '$lib/server/contextBreakSettingsStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  await requireChatRoomReadAccess(request, room);

  return json({ enforcement: getContextBreakEnforcement(params.roomId) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  requireChatRoomMutationAuth(params.roomId, request, payload);

  if (!isContextBreakEnforcement(payload.enforcement)) {
    throw error(400, 'enforcement must be off|advisory|hard.');
  }

  return json({
    enforcement: setContextBreakEnforcement(params.roomId, payload.enforcement)
  });
};
