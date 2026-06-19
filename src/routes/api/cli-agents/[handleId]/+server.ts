/**
 * /api/cli-agents/[handleId] — inspect / command / stop one bridge
 * (CLI-HOOK-BRIDGE Phase 5, 2026-05-15, JWPK).
 *
 * GET    /api/cli-agents/:handleId
 *   -> 200 { handleId, cli, cwd, spawnedAtMs, sessionId }
 *   -> 404 unknown handle
 *
 * POST   /api/cli-agents/:handleId/command
 *   Body: protocol-specific. For codex: { method, params }. For pi:
 *         the pi RPC command shape (e.g. { type: 'compact' }).
 *   -> 200 { result }
 *   -> 404 unknown handle
 *   -> 400 invalid command shape
 *   -> 500 underlying RPC error
 *
 * DELETE /api/cli-agents/:handleId
 *   -> 200 { stopped: true }
 *   -> 404 unknown handle (idempotent — already-stopped also 404 once
 *          the registry has cleaned the entry up)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCliAgent } from '$lib/server/cliAgentRegistry';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

function serialiseAgent(handle: NonNullable<ReturnType<typeof getCliAgent>>) {
  return {
    handleId: handle.handleId,
    cli: handle.cli,
    cwd: handle.cwd,
    spawnedAtMs: handle.spawnedAtMs,
    sessionId: handle.getSessionId()
  };
}

export const GET: RequestHandler = ({ params, request }) => {
  requireAggregateReadAuth(request, `/api/cli-agents/${params.handleId ?? ''}`);
  const handle = getCliAgent(params.handleId ?? '');
  if (!handle) throw error(404, 'unknown agent handle');
  return json(serialiseAgent(handle));
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  requireOperatorLikeAuth(request);
  const handle = getCliAgent(params.handleId ?? '');
  if (!handle) throw error(404, 'unknown agent handle');
  await handle.stop();
  return json({ stopped: true });
};
