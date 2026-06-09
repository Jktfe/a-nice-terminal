import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import { castVoteBallot, getVoteBallotHistory, type VoteBallotEvent } from '$lib/server/voteStore';
import { postVoteReceipts, requiredString } from '$lib/server/voteRouteHelpers';

export const POST: RequestHandler = async ({ params, request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');
  const body = rawBody as Record<string, unknown>;
  const roomId = requiredString(body.roomId, 'roomId');
  const optionId = requiredString(body.optionId, 'optionId');
  const voterHandle = resolveCallerIdentityStrict(roomId, request, rawBody);
  try {
    const vote = castVoteBallot({
      voteId: params.voteId,
      voterHandle,
      optionId,
      roomId,
      reason: typeof body.reason === 'string' ? body.reason : null
    });
    postVoteReceipts(
      vote,
      `🗳️ Vote cast by ${voterHandle}: ${vote.title}\n` +
        `voteID=${vote.id} ${castReceiptSummary(vote.id, voterHandle)} state=${vote.state} missing=${vote.missingVoters.join(', ') || '-'}`
    );
    return json({ vote });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not cast vote.';
    if (message.includes('not found')) throw error(404, message);
    throw error(409, message);
  }
};

function castReceiptSummary(voteId: string, voterHandle: string): string {
  const event = getVoteBallotHistory(voteId)
    .filter((candidate: VoteBallotEvent) => candidate.voterHandle === voterHandle)
    .at(-1);
  if (!event) return 'choice=unknown';
  const previous = event.previousOptionLabel ? ` changedFrom=${event.previousOptionLabel}` : '';
  return `choice=${event.optionLabel}${previous}`;
}
