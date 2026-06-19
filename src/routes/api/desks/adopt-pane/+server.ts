/**
 * Port audit (2026-06-19): source
 * src/routes/api/terminals/adopt-local/+server.ts lines 1-179.
 * Verdict: CHANGE. vNext simplification: default-socket pane adoption speaks
 * the clean Desk noun directly: create/update Desk, claim ANThandle, bind pane.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { isOperatorHandle } from '$lib/server/operatorHandle';
import { adoptPaneAsDesk, TerminalDeskError } from '$lib/server/terminalDeskFacade';

export const POST: RequestHandler = async ({ request }) => {
  const actor = resolveTerminalCallerHandle(request);
  if (!actor) throw error(401, 'browser-session or admin-bearer required.');
  if (!isOperatorHandle(actor)) throw error(403, 'Only the operator can adopt local tmux panes.');
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  try {
    return json(adoptPaneAsDesk({
      pane: body.pane,
      handle: body.handle,
      name: body.name,
      deskId: body.deskId,
      cli: body.cli,
      bootCommand: body.bootCommand,
      pid: body.pid,
      pidStart: body.pidStart,
      actor
    }), { status: 201 });
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
