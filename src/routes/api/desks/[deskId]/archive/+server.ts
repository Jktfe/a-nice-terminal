/**
 * Port audit (2026-06-19): no direct code copy. Source contract came from the
 * ANT delivery Desk facade checklist. Verdict: CHANGE. vNext simplification:
 * this route is a thin owner/operator-auth wrapper over one Desk facade verb.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { archiveDesk, TerminalDeskError } from '$lib/server/terminalDeskFacade';
import { requireTerminalDeskMutationActor } from '$lib/server/terminalDeskMutationAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const { actor } = await requireTerminalDeskMutationActor(request, deskId);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    return json(archiveDesk({ deskId, actor, reason: body?.reason }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
