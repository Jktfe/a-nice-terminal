/**
 * GET /api/terminals/handles → { handles: string[], explicit: string[] }
 *
 * Per JWPK PICKER-SAME-SET (2026-05-14): the picker source-of-truth must
 * be the FULL set of ANT terminals, not just the ones with explicit
 * handles. `handles` is the union of explicit + derived (via deriveHandle).
 * `explicit` is the original S7 list (kept for callers that need it).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTerminals } from '$lib/server/ptyClient';
import { listCurrentInvitePickerHandles } from '$lib/server/terminalRecordsStore';

export const GET: RequestHandler = async () => {
  const aliveSessionIds = await listTerminals();
  return json(listCurrentInvitePickerHandles(aliveSessionIds));
};
