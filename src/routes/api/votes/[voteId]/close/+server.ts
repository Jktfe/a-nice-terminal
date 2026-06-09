import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import { ADMIN_BEARER_HANDLE, tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { closeVote, getVote } from '$lib/server/voteStore';
import { postVoteReceipts, requiredString } from '$lib/server/voteRouteHelpers';

export const POST: RequestHandler = async ({ params, request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');
  const body = rawBody as Record<string, unknown>;
  const roomId = requiredString(body.roomId, 'roomId');
  const voteBeforeClose = getVote(params.voteId);
  if (!voteBeforeClose) throw error(404, 'Vote not found.');
  if (!voteBeforeClose.roomIds.includes(roomId)) {
    throw error(409, `Room ${roomId} is not bound to vote ${params.voteId}.`);
  }
  // Admin-bearer (CLI/automation) is the same sentinel path the mutating
  // chat-room sub-routes use; it short-circuits the per-handle authorization.
  const isAdmin = tryAdminBearer(request);
  const closedByHandle = isAdmin
    ? ADMIN_BEARER_HANDLE
    : resolveCallerIdentityStrict(roomId, request, rawBody);
  if (!isAdmin) {
    // Only the vote creator or the room chair/owner may close. The bound
    // room's `whoCreatedIt` is the room_owner per permissionApproverResolver.
    const isCreator = closedByHandle === voteBeforeClose.createdByHandle;
    const room = findChatRoomById(roomId);
    const isChair = room ? closedByHandle === room.whoCreatedIt : false;
    if (!isCreator && !isChair) {
      throw error(403, 'Only the vote creator, the room chair/owner, or an admin may close this vote.');
    }
  }
  const vote = closeVote({ voteId: params.voteId, closedByHandle });
  postVoteReceipts(
    vote,
    `🗳️ Vote closed by ${closedByHandle}: ${vote.title}\n` +
      `voteID=${vote.id} state=${vote.state} tally=${vote.tally.map((row) => `${row.label}=${row.count}`).join(' · ')}`
  );
  return json({ vote });
};
