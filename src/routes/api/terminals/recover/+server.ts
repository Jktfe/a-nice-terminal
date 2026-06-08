/**
 * POST /api/terminals/recover
 *   Body: { sessionIds: string[], resume?: boolean, launchAgents?: boolean,
 *           dryRun?: boolean }
 *     → 200 { recovered: RecoverOutcome[] }
 *
 * Rebuild agent sessions after a reboot kills the tmux server: recreate each
 * pane under the same sessionId in its original cwd, un-archive + rebind
 * identity, and retype the launch command (stored, mined-from-history, or a
 * per-agent default) so the agent runs again. `dryRun:true` resolves the
 * commands without side effects — drives the UI "show command" preview.
 *
 * Security: spawn-locality parity with POST /api/terminals — block
 * remote-bridge bearer tokens (Bearer rbt_*) from driving the raw-PTY path.
 * Recovery must be triggered from the local machine (or the operator's browser
 * session), never a remote bridge.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recoverSessions } from '$lib/server/sessionRecovery';

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer rbt_')) {
    throw error(403, 'Remote-bridge bearer tokens cannot recover terminals. Recover from the local machine.');
  }

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    throw error(400, 'Send a JSON body with a sessionIds array.');
  }
  const sessionIds = Array.isArray(raw.sessionIds)
    ? raw.sessionIds.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];
  if (sessionIds.length === 0) {
    throw error(400, 'sessionIds must be a non-empty array of session ids.');
  }
  const resume = raw.resume === true;
  // launchAgents defaults to true — recovery means the agent is running again.
  const launchAgents = raw.launchAgents !== false;
  const dryRun = raw.dryRun === true;

  const recovered = await recoverSessions(sessionIds, { resume, launchAgent: launchAgents, dryRun });
  return json({ recovered });
};
