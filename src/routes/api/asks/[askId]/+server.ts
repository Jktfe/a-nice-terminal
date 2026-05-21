/**
 * GET /api/asks/:askId → one ask by id
 *
 * Task #130 fix: adds the missing single-ask GET route.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAskById } from '$lib/server/askStore';

export const GET: RequestHandler = ({ params }) => {
  const ask = findAskById(params.askId);
  if (!ask) throw error(404, 'Ask not found.');
  return json({ ask });
};
