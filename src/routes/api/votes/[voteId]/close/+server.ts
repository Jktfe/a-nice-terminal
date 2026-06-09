import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
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
  const closedByHandle = resolveCallerIdentityStrict(roomId, request, rawBody);
  const vote = closeVote({ voteId: params.voteId, closedByHandle });
  postVoteReceipts(
    vote,
    `🗳️ Vote closed by ${closedByHandle}: ${vote.title}\n` +
      `voteID=${vote.id} state=${vote.state} tally=${vote.tally.map((row) => `${row.label}=${row.count}`).join(' · ')}`
  );
  return json({ vote });
};
