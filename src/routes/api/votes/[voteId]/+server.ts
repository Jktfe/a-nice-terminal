import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getVote, getVoteBallotHistory } from '$lib/server/voteStore';

export const GET: RequestHandler = ({ params }) => {
  const vote = getVote(params.voteId);
  if (!vote) throw error(404, 'Vote not found.');
  // Append-only audit trail: every cast (incl. re-votes), oldest first.
  return json({ vote, history: getVoteBallotHistory(params.voteId) });
};
