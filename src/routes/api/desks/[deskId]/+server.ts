/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/[deskId]/+server.ts lines 1-9.
 * Verdict: CHANGE. vNext simplification: one Desk read route over the
 * deployed terminal model; mutation verbs live in explicit child routes.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalDesk } from '$lib/server/terminalDeskFacade';

export const GET: RequestHandler = ({ params }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const desk = getTerminalDesk(deskId);
  if (!desk) throw error(404, 'Desk not found.');
  return json({ desk });
};
