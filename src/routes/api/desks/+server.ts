/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/+server.ts lines 1-5.
 * Verdict: CHANGE. vNext simplification: expose only the read facade over the
 * deployed terminal model for the first production batch.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import { listTerminalDesks } from '$lib/server/terminalDeskFacade';

export const GET: RequestHandler = ({ request }) => {
  requireOperatorLikeAuth(request);
  return json({ desks: listTerminalDesks() });
};
