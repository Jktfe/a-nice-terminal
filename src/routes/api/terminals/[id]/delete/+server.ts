/**
 * POST /api/terminals/[id]/delete — delete an ARCHIVED (non-alive) terminal.
 *
 * Two explicit modes (JWPK):
 *   - 'mine-and-delete'      → export the retained session to the durable ANT
 *                              archive FIRST (preserve the mineable value),
 *                              mark the session mined, THEN remove it.
 *   - 'delete-without-mining'→ remove it without preserving the value.
 *
 * Ordering is mine → delete so a deletion failure can never lose freshly-mined
 * value. The response is truthful (codex review contract): the mode taken, the
 * archive reference if mined, the removed terminal id, and an explicit
 * partial-failure shape (deleted:false + the mined ref) if mining succeeded but
 * deletion did not. Operator/owner gated; refuses a LIVE terminal (kill first).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { isSuperAdmin } from '$lib/server/orgStore';
import { canCallerActOnTerminal } from '$lib/server/allowlistGuard';
import { getTerminalRecord, deleteTerminalRecord } from '$lib/server/terminalRecordsStore';
import { listTerminals } from '$lib/server/ptyClient';
import { softDeleteTerminalRunEvents } from '$lib/server/terminalRunEventsStore';
import { archiveTerminalRunEvents } from '$lib/server/terminalArchiveExport';
import { markSessionMined } from '$lib/server/firehoseMiningState';

type DeleteMode = 'mine-and-delete' | 'delete-without-mining';

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');

  const callerHandle = resolveTerminalCallerHandle(request);
  if (!callerHandle) throw error(401, 'browser-session or admin-bearer required');

  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, 'terminal not found.');
  if (!isSuperAdmin(callerHandle) && !canCallerActOnTerminal(callerHandle, record)) {
    throw error(403, 'caller is not allowed to delete this terminal');
  }

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mode: DeleteMode = raw?.mode === 'mine-and-delete' ? 'mine-and-delete' : 'delete-without-mining';

  // This endpoint is for ARCHIVED terminals; a live one must be killed first.
  const alive = (await listTerminals()).includes(sessionId);
  if (alive) throw error(409, 'terminal is live — kill it before deleting.');

  const nowMs = Date.now();
  let mined: { archivedTo: string; eventsArchived: number } | undefined;

  // 1. MINE first so a later deletion failure can't lose the value.
  if (mode === 'mine-and-delete') {
    try {
      mined = archiveTerminalRunEvents(sessionId, { nowMs });
      markSessionMined({ terminalId: sessionId, windowStartMs: 0, windowEndMs: nowMs });
    } catch (e) {
      throw error(500, `mining failed — nothing was deleted: ${(e as Error).message}`);
    }
  }

  // 2. DELETE: soft-delete the run-events (recoverable rows; respects the
  // firehose-asset rule) + remove the desk record.
  try {
    const runEventsHidden = softDeleteTerminalRunEvents(sessionId, nowMs);
    deleteTerminalRecord(sessionId);
    return json({ mode, mined: mined ?? null, deleted: true, terminalId: sessionId, runEventsHidden });
  } catch (e) {
    // Partial failure: if we mined, the value is safely archived. Truthful.
    return json(
      {
        mode,
        mined: mined ?? null,
        deleted: false,
        terminalId: sessionId,
        error: `deletion failed after mining: ${(e as Error).message}`
      },
      { status: 207 }
    );
  }
};
