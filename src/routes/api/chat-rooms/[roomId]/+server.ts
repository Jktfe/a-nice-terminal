/**
 * Read one chat room directly.
 *
 * GET /api/chat-rooms/:roomId → returns the room or 404.
 * DELETE /api/chat-rooms/:roomId → soft-delete the room (204) or 404.
 *
 * This keeps room-detail routes from fetching every room just to find one.
 * DELETE is a soft-delete (chat_rooms.deleted_at_ms) per JWPK SURFACE-SIZE-ONLY
 * pattern — files + index rows survive, the room just stops listing.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById, softDeleteChatRoom } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = async ({ params }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) {
    throw error(404, 'Room not found.');
  }
  return json({ chatRoom: room });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): identity-gate the
  // room-level DELETE. Without this any unauthenticated caller could
  // soft-delete any room in the instance.
  requireChatRoomMutationAuth(params.roomId, request, null);
  const wasDeleted = softDeleteChatRoom(params.roomId);
  if (!wasDeleted) {
    throw error(404, 'Room not found.');
  }
  return new Response(null, { status: 204 });
};
