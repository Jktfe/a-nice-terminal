/**
 * DELETE /api/file-refs/[id] → remove one file_ref. Returns 204 on success,
 * 404 when no row matched the id. GET returns the single row or 404 (handy
 * for the CLI `flag list` shape parity check + future detail views).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFileRef, removeFileRef } from '$lib/server/fileRefsStore';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

export const GET: RequestHandler = async ({ request, params }) => {
  requireOperatorLikeAuth(request);
  const ref = getFileRef(params.id);
  if (!ref) throw error(404, 'file_ref not found.');
  return json({ fileRef: ref });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  requireOperatorLikeAuth(request);
  const wasRemoved = removeFileRef(params.id);
  if (!wasRemoved) throw error(404, 'file_ref not found.');
  return new Response(null, { status: 204 });
};
