/**
 * HTTP endpoints for the global cwd bookmark pills (TerminalFolderPicker).
 *
 * GET  /api/cwd-bookmarks → list every bookmark, smallest order_index first.
 * POST /api/cwd-bookmarks → create one bookmark from { path }. Idempotent:
 *   posting an already-bookmarked path returns the existing record (200),
 *   new path returns 201.
 *
 * Per JWPK 2026-05-15 lock (same as quick-shortcuts): global scope, no auth
 * gate (user prefs, easy to recreate). Empty path after trim fails with 400.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createCwdBookmark,
  listCwdBookmarks
} from '$lib/server/cwdBookmarksStore';

export const GET: RequestHandler = async () => {
  return json({ bookmarks: listCwdBookmarks() });
};

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with a path field.');
  }

  const pathFromBody = (rawBody as { path?: unknown }).path;
  if (typeof pathFromBody !== 'string') {
    throw error(400, 'The path field must be a string.');
  }

  try {
    const existingBefore = listCwdBookmarks().some((b) => b.path === pathFromBody.trim());
    const bookmark = createCwdBookmark({ path: pathFromBody });
    return json({ bookmark }, { status: existingBefore ? 200 : 201 });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error
        ? causeOfFailure.message
        : 'Could not create bookmark.';
    throw error(400, message);
  }
};
