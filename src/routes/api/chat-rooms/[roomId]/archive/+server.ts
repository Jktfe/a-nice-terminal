/**
 * Archive / unarchive a chat room (DASH-ARCHIVE 2026-05-15).
 *
 *   POST   /api/chat-rooms/:roomId/archive
 *     → 204 on state change (archived_at_ms set)
 *     → 404 if room is missing, already archived, or already soft-deleted
 *
 *   DELETE /api/chat-rooms/:roomId/archive
 *     → 204 on state change (archived_at_ms cleared)
 *     → 404 if room is not currently archived, or is soft-deleted, or missing
 *
 * Archive is non-destructive and recoverable; mirrors deleted_at_ms but kept
 * in a separate column so future undelete + unarchive paths stay independent.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { archiveChatRoom, unarchiveChatRoom } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const POST: RequestHandler = async ({ params, request }) => {
  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): identity-gate the
  // archive endpoint. Without this any unauthenticated caller could
  // archive any room in the instance.
  requireChatRoomMutationAuth(params.roomId, request, null);
  const ok = archiveChatRoom(params.roomId);
  if (!ok) {
    throw error(404, 'Room not found.');
  }
  return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  requireChatRoomMutationAuth(params.roomId, request, null);
  const ok = unarchiveChatRoom(params.roomId);
  if (!ok) {
    throw error(404, 'Room not archived.');
  }
  return new Response(null, { status: 204 });
};
