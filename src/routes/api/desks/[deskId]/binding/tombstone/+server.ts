/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/routes/api/desks/[deskId]/binding/tombstone/+server.ts
 * lines 1-21. Verdict: CHANGE. vNext simplification: same verb shape,
 * backed by the deployed Desk facade and explicit owner/operator auth.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TerminalDeskError, tombstoneDeskPane } from '$lib/server/terminalDeskFacade';
import { requireTerminalDeskMutationActor } from '$lib/server/terminalDeskMutationAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const { actor } = await requireTerminalDeskMutationActor(request, deskId);
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  try {
    return json(tombstoneDeskPane({
      deskId,
      actor,
      reason: body?.reason
    }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
