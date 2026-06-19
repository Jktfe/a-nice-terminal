/**
 * Delete one cwd bookmark.
 *
 * DELETE /api/cwd-bookmarks/:id → hard-delete, 204 / 404.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteCwdBookmark } from '$lib/server/cwdBookmarksStore';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

export const DELETE: RequestHandler = async ({ request, params }) => {
  requireOperatorLikeAuth(request);
  const wasDeleted = deleteCwdBookmark(params.id);
  if (!wasDeleted) {
    throw error(404, 'Cwd bookmark not found.');
  }
  return new Response(null, { status: 204 });
};
