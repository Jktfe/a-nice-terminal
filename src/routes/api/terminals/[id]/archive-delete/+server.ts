/**
 * POST /api/terminals/:id/archive-delete
 *
 * Body:
 *   { mode: 'mine-and-delete' | 'delete' }
 *
 * Archived terminal removal for the antOS terminals page. This never kills a
 * pane; it is only for records already out of the live surface. For
 * mine-and-delete, the retained ANT output is exported first, then the terminal
 * record is removed from the visible archive list and the terminal lifecycle is
 * marked deleted. If mining succeeds but removal fails, the response says so
 * and includes the archive path.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canCallerActOnTerminal } from '$lib/server/allowlistGuard';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { isSuperAdmin } from '$lib/server/orgStore';
import { mineArchivedTerminalRunEvents, type ArchivedTerminalMineResult } from '$lib/server/archivedTerminalMineStore';
import { deleteTerminalRecord, getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getTerminalById, setTerminalStatus } from '$lib/server/terminalsStore';

type ArchiveDeleteMode = 'mine-and-delete' | 'delete';

function parseMode(raw: unknown): ArchiveDeleteMode {
  return raw === 'mine-and-delete' ? 'mine-and-delete' : 'delete';
}

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');

  const callerHandle = resolveTerminalCallerHandle(request);
  if (!callerHandle) throw error(401, 'browser-session or admin-bearer required');

  const record = getTerminalRecord(sessionId);
  if (!record) throw error(404, 'archived terminal record not found');

  const terminal = getTerminalById(sessionId);
  if (terminal?.status === 'live') {
    throw error(409, 'terminal is still live; archive or kill it before deleting from the archive');
  }

  const operatorBypass = isSuperAdmin(callerHandle);
  if (!operatorBypass && !canCallerActOnTerminal(callerHandle, record)) {
    throw error(403, 'caller is not allowed to delete this archived terminal');
  }

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mode = parseMode(raw?.mode);

  let mined: ArchivedTerminalMineResult | null = null;
  if (mode === 'mine-and-delete') {
    try {
      mined = mineArchivedTerminalRunEvents({
        terminalId: sessionId,
        displayName: record.name
      });
    } catch (err) {
      return json({
        sessionId,
        mode,
        mined: null,
        deleted: false,
        error: err instanceof Error ? err.message : 'mining failed before delete'
      }, { status: 500 });
    }
  }

  try {
    deleteTerminalRecord(sessionId);
    const statusUpdated = setTerminalStatus(sessionId, 'deleted');
    return json({
      sessionId,
      mode,
      mined,
      deleted: true,
      removedTerminalRecord: true,
      terminalStatus: statusUpdated ? 'deleted' : 'missing-terminal-row'
    });
  } catch (err) {
    return json({
      sessionId,
      mode,
      mined,
      deleted: false,
      removedTerminalRecord: false,
      error: err instanceof Error ? err.message : 'delete failed after mining'
    }, { status: 500 });
  }
};
