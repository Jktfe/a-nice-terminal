import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { getVote, getVoteBallotHistory } from '$lib/server/voteStore';

export const GET: RequestHandler = async ({ params, url, request }) => {
  // Room-scoped show (post-alignment): the caller must name a bound room and
  // prove read access to it before any vote detail / tally / ballot history
  // is returned.
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId query parameter is required.');
  const vote = getVote(params.voteId);
  if (!vote) throw error(404, 'Vote not found.');
  if (!vote.roomIds.includes(roomId)) {
    throw error(409, `Room ${roomId} is not bound to vote ${params.voteId}.`);
  }
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);
  // Append-only audit trail: every cast (incl. re-votes), oldest first.
  return json({ vote, history: getVoteBallotHistory(params.voteId) });
};
