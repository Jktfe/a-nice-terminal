// POST /api/manual/states/:screenId
// Create a new state row for a screen. Slice 2 (JWPK 2026-05-23):
// state-switcher author flow uses this to add a new dropdown-open /
// menu-open / etc. variant to the screen's tab strip.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertScreenState, listStatesForScreen } from '$lib/server/manualScreenStore';

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `state-${Date.now().toString(36)}`;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const screenId = params.screenId ?? '';
  if (!screenId) throw error(400, 'screenId required');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const stateLabel = typeof body.stateLabel === 'string' && body.stateLabel.trim().length > 0
    ? body.stateLabel.trim()
    : null;
  if (!stateLabel) throw error(400, 'stateLabel required');

  const stateSlug = typeof body.stateSlug === 'string' && body.stateSlug.trim().length > 0
    ? slugify(body.stateSlug)
    : slugify(stateLabel);

  const screenshotPath = typeof body.screenshotPath === 'string' && body.screenshotPath.trim().length > 0
    ? body.screenshotPath.trim()
    : '/manual/placeholder.png';

  const viewportW = typeof body.viewportW === 'number' && body.viewportW > 0 ? body.viewportW : 2560;
  const viewportH = typeof body.viewportH === 'number' && body.viewportH > 0 ? body.viewportH : 1600;
  const description = typeof body.description === 'string' ? body.description : null;

  // Append to end by giving sort_order = max + 1
  const existing = listStatesForScreen(screenId);
  const sortOrder = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.sort_order)) + 1;

  const state = upsertScreenState({
    screenId, stateSlug, stateLabel, description,
    screenshotPath, viewportW, viewportH, sortOrder
  });
  return json({ state }, { status: 201 });
};
