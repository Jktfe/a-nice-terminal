/**
 * /api/terminals/[id]/heal — repair an ANT-spawned terminal's identity
 * row in the `terminals` table without disrupting the running shell
 * (2026-05-16, JWPK T1 incident follow-up).
 *
 * Why this exists: `POST /api/terminals` auto-registers the identity
 * row at spawn time as of 2026-05-16 (see autoRegisterTerminalForSpawnedSession).
 * But terminals spawned BEFORE that fix won't have one — they're
 * "orphans" whose linked-chat self-post path 403s. /heal is the
 * one-shot remedy: re-queries tmux for the live pane PID, re-inserts
 * the identity row, reports the outcome.
 *
 * Idempotent. Safe to call on healthy terminals (just re-confirms the
 * existing row). Does NOT touch the daemon or kill/restart anything.
 *
 * Security: spawn-locality parity — blocks Bearer rbt_* like
 * POST /api/terminals does. Otherwise no positive auth requirement;
 * the endpoint is intended for loopback callers.
 *
 * Contract:
 *   POST /api/terminals/<sessionId>/heal
 *     -> 200 { healed: true, terminal: TerminalRow, message: string }
 *        when tmux had the pane and the row is now registered.
 *     -> 200 { healed: false, terminal: null, message: string }
 *        when no tmux pane found (terminal may have been killed).
 *     -> 404 unknown sessionId in terminal_records
 *     -> 403 Bearer rbt_*
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import {
  autoRegisterTerminalForSpawnedSession,
  getTerminalById
} from '$lib/server/terminalsStore';

function rejectRemoteBridgeBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer rbt_')) {
    throw error(403, 'Remote-bridge bearer tokens cannot heal terminal identity.');
  }
}

export const POST: RequestHandler = async ({ params, request }) => {
  rejectRemoteBridgeBearer(request);

  const sessionId = params.id ?? '';
  if (sessionId.length === 0) {
    throw error(400, 'sessionId path param is required.');
  }

  const record = getTerminalRecord(sessionId);
  if (!record) {
    throw error(404, `no terminal_records row for sessionId=${sessionId}`);
  }
  if (!record.tmux_target_pane) {
    return json({
      healed: false,
      terminal: null,
      message: 'terminal_records row exists but has no tmux_target_pane — nothing to heal'
    });
  }

  const registered = autoRegisterTerminalForSpawnedSession({
    sessionId,
    tmuxTargetPane: record.tmux_target_pane,
    agentKind: record.agent_kind
  });

  if (!registered) {
    return json({
      healed: false,
      terminal: null,
      tmuxPane: record.tmux_target_pane,
      message: 'tmux pane not found (terminal may have been killed). The terminal_records row stays, but no identity could be registered.'
    });
  }

  // Re-read to get the canonical row (auto-register returns it but
  // for tests + future-proofing we look it up fresh).
  const fresh = getTerminalById(sessionId);
  return json({
    healed: true,
    terminal: fresh,
    message: `Registered identity row for ${sessionId} (pid=${registered.pid}). Linked-chat self-posts should now work.`
  });
};
