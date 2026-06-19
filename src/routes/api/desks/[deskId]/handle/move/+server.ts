/**
 * Port audit (2026-06-19): source
 * src/routes/api/terminals/[id]/handle-claim/+server.ts lines 1-63.
 * Verdict: CHANGE. vNext simplification: keep the same auth/permission and
 * atomic store verb, but return the Desk envelope antOS mutating clients decode.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import {
  canMoveHandleClaim
} from '$lib/server/terminalHandleClaimStore';
import {
  moveTerminalDeskHandle,
  TerminalDeskError
} from '$lib/server/terminalDeskFacade';

export const POST: RequestHandler = async ({ params, request }) => {
  const deskId = params.deskId ?? '';
  if (!deskId) throw error(400, 'Desk id required.');
  const targetRecord = getTerminalRecord(deskId);
  if (!targetRecord) throw error(404, 'Desk not found.');

  const actor = resolveTerminalCallerHandle(request);
  if (!actor) throw error(401, 'browser-session or admin-bearer required.');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  const handle = typeof body.handle === 'string' ? body.handle.trim() : '';
  if (!handle) throw error(400, 'handle required.');
  const validation = validateHandleForRegistration(handle);
  if (!validation.ok) throw error(400, validation.message);
  const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
    ? body.reason.trim()
    : 'operator-handle-move';

  if (!canMoveHandleClaim({
    callerHandle: actor,
    targetRecord,
    rawHandle: validation.canonicalHandle,
    operatorHandle: getOperatorHandle()
  })) {
    throw error(403, `caller ${actor} cannot move ${validation.canonicalHandle} onto Desk ${deskId}`);
  }

  try {
    return json(moveTerminalDeskHandle({
      deskId,
      handle: validation.canonicalHandle,
      actor,
      reason
    }));
  } catch (cause) {
    if (cause instanceof TerminalDeskError) throw error(cause.status, cause.message);
    throw cause;
  }
};
