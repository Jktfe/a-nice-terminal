/**
 * POST /api/terminals/:id/handle-claim
 *
 * Move an ANThandle claim onto a Desk and, when the Desk has a current pane,
 * witness-bind that handle to the pane. This is the explicit server verb for
 * "claim t1next on this new pane" after pane death/replacement.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import {
  canMoveHandleClaim,
  moveHandleClaimToTerminal
} from '$lib/server/terminalHandleClaimStore';

export const POST: RequestHandler = async ({ params, request }) => {
  const terminalId = params.id ?? '';
  if (!terminalId) throw error(400, 'terminal id required.');
  const targetRecord = getTerminalRecord(terminalId);
  if (!targetRecord) throw error(404, 'terminal not found.');

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
    throw error(403, `caller ${actor} cannot move ${validation.canonicalHandle} onto terminal ${terminalId}`);
  }

  try {
    const result = moveHandleClaimToTerminal({
      rawHandle: validation.canonicalHandle,
      targetTerminalId: terminalId,
      actor,
      reason
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not move handle claim.';
    const status = message.startsWith('terminal not found:') ? 404 : 400;
    throw error(status, message);
  }
};
