// GET /api/manual/states/:screenId/:stateSlug — fetch the state row +
// all annotations + the suggestion feed scoped to that state.
// PATCH — update state metadata (label, description, screenshot, dims).
// DELETE — remove state. FK cascade in manual_element_annotations
// drops annotations automatically.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getScreenState,
  listAnnotationsForState,
  listSuggestions,
  upsertScreenState
} from '$lib/server/manualScreenStore';
import { getIdentityDb } from '$lib/server/db';

export const GET: RequestHandler = async ({ params }) => {
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  if (!screenId || !stateSlug) throw error(400, 'screenId and stateSlug required');

  const state = getScreenState(screenId, stateSlug);
  if (!state) throw error(404, 'state not found');

  return json({
    state,
    annotations: listAnnotationsForState(screenId, stateSlug),
    suggestions: listSuggestions({ screenId, stateSlug })
  });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  if (!screenId || !stateSlug) throw error(400, 'screenId and stateSlug required');

  const current = getScreenState(screenId, stateSlug);
  if (!current) throw error(404, 'state not found');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const stateLabel = typeof body.stateLabel === 'string' && body.stateLabel.trim().length > 0
    ? body.stateLabel.trim() : current.state_label;
  const description = body.description === undefined
    ? current.description
    : (typeof body.description === 'string' ? body.description : null);
  const screenshotPath = typeof body.screenshotPath === 'string' && body.screenshotPath.trim().length > 0
    ? body.screenshotPath.trim() : current.screenshot_path;
  const viewportW = typeof body.viewportW === 'number' && body.viewportW > 0 ? body.viewportW : current.viewport_w;
  const viewportH = typeof body.viewportH === 'number' && body.viewportH > 0 ? body.viewportH : current.viewport_h;
  const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : current.sort_order;

  const state = upsertScreenState({
    screenId, stateSlug, stateLabel, description,
    screenshotPath, viewportW, viewportH, sortOrder
  });
  return json({ state });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  if (!screenId || !stateSlug) throw error(400, 'screenId and stateSlug required');

  const db = getIdentityDb();
  // FK ON DELETE CASCADE on manual_element_annotations drops the
  // annotations atomically; we explicitly delete annotations + state
  // in a transaction so SQLite without enabled FKs still does the
  // right thing.
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM manual_element_annotations WHERE screen_id = ? AND state_slug = ?`)
      .run(screenId, stateSlug);
    const result = db.prepare(`DELETE FROM manual_screen_states WHERE screen_id = ? AND state_slug = ?`)
      .run(screenId, stateSlug);
    return result.changes;
  });
  const deleted = tx();
  return json({ deleted });
};
