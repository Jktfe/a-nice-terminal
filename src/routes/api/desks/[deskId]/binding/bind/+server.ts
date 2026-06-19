/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/[deskId]/binding/bind/+server.ts
 * lines 1-24. Verdict: CHANGE. vNext simplification: same verb shape,
 * backed by the deployed Desk facade and explicit owner/operator auth.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bindDeskPane, TerminalDeskError } from '$lib/server/terminalDeskFacade';
import { requireTerminalDeskMutationActor } from '$lib/server/terminalDeskMutationAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const { actor } = await requireTerminalDeskMutationActor(request, deskId);
  const body = (await request.json().catch(() => null)) as {
    pane?: unknown;
    pid?: unknown;
    pidStart?: unknown;
  } | null;
  try {
    return json(bindDeskPane({
      deskId,
      pane: body?.pane,
      pid: body?.pid,
      pidStart: body?.pidStart,
      actor
    }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
