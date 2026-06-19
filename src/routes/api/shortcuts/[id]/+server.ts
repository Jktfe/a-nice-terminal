/**
 * DELETE /api/shortcuts/:id — hard-delete a scoped shortcut.
 *
 * 204 No Content on success, 404 if no shortcut with that id exists.
 * Mirrors the quick-shortcuts [id] DELETE handler.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeShortcut } from '$lib/server/shortcutsStore';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

export const DELETE: RequestHandler = async ({ params, request }) => {
  requireOperatorLikeAuth(request);
  const wasRemoved = removeShortcut(params.id);
  if (!wasRemoved) {
    throw error(404, 'Shortcut not found.');
  }
  return new Response(null, { status: 204 });
};
