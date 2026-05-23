// GET /api/manual/states/:screenId/:stateSlug — fetch the state row +
// all annotations + the suggestion feed scoped to that state.
// Workspace-public read.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getScreenState,
  listAnnotationsForState,
  listSuggestions
} from '$lib/server/manualScreenStore';

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
