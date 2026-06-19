/**
 * Port audit (2026-06-19): source
 * src/routes/api/terminals/[id]/delete/+server.ts lines 1-84.
 * Verdict: CHANGE. vNext simplification: keep the archived-only mine/delete
 * ordering and truthful partial-failure response, but return a Desk-shaped
 * envelope and soft-delete the intrinsic linked room with the Desk.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDesk, TerminalDeskError } from '$lib/server/terminalDeskFacade';
import { requireTerminalDeskMutationActor } from '$lib/server/terminalDeskMutationAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const { actor } = await requireTerminalDeskMutationActor(request, deskId);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required.');
  try {
    const result = await deleteDesk({ deskId, actor, mode: body.mode });
    return json(result, { status: result.deleted ? 200 : 207 });
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
