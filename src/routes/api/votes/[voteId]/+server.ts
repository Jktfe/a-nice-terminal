import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getVote } from '$lib/server/voteStore';

export const GET: RequestHandler = ({ params }) => {
  const vote = getVote(params.voteId);
  if (!vote) throw error(404, 'Vote not found.');
  return json({ vote });
};
