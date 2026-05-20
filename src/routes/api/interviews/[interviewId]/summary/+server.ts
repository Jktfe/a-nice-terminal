/**
 * GET /api/interviews/:interviewId/summary — heuristic digest of one
 * interview. Powers `ant interview summary <interviewId>`.
 *
 * Read-only. No auth gate today (parity with chair-digest GET routes —
 * digests are intra-instance reads). 404 when the interview id is
 * unknown. Otherwise returns the InterviewSummary envelope built by
 * buildInterviewSummary (first / middle / last messages + per-author
 * counts + duration + status).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildInterviewSummary } from '$lib/server/interviewSummary';

export const GET: RequestHandler = async ({ params }) => {
  const summary = buildInterviewSummary(params.interviewId);
  if (!summary) throw error(404, 'Interview not found.');
  return json({ summary });
};
