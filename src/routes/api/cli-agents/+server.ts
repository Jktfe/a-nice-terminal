/**
 * /api/cli-agents — list + start ANT-spawned CLI bridges
 * (CLI-HOOK-BRIDGE Phase 5, 2026-05-15, JWPK).
 *
 * GET  /api/cli-agents
 *   -> 200 { agents: [{ handleId, cli, cwd, spawnedAtMs, sessionId }] }
 *
 * POST /api/cli-agents
 *   Body: { cli: 'codex'|'pi', cwd?: string, sessionDir?: string }
 *   -> 201 { handleId, cli, cwd, spawnedAtMs, sessionId? }
 *   -> 400 invalid cli kind / missing required fields
 *   -> 403 Authorization: Bearer rbt_*  (spawn-locality parity)
 *   -> 500 spawn failure (typically: binary not on PATH)
 *
 * Spawn-locality gate matches `/api/terminals` and `/api/cli-hook`:
 * remote-bridge bearer tokens cannot spawn ANT-managed child processes.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listCliAgents,
  startCliAgent,
  type CliAgentKind
} from '$lib/server/cliAgentRegistry';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { serialiseCliAgent } from '$lib/server/cliAgentSerialise';

function rejectRemoteBridgeBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer rbt_')) {
    throw error(403, 'Remote-bridge bearer tokens cannot spawn CLI agents.');
  }
}

const serialiseAgent = serialiseCliAgent;

export const GET: RequestHandler = ({ request }) => {
  requireAggregateReadAuth(request, '/api/cli-agents');
  return json({ agents: listCliAgents().map(serialiseAgent) });
};

export const POST: RequestHandler = async ({ request }) => {
  rejectRemoteBridgeBearer(request);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    body = parsed as Record<string, unknown>;
  } catch (cause) {
    if ((cause as { status?: number } | null)?.status === 400) throw cause;
    throw error(400, 'Body must be valid JSON.');
  }

  const cli = body.cli;
  if (cli !== 'codex' && cli !== 'pi') {
    throw error(400, `cli must be "codex" or "pi", got ${JSON.stringify(cli)}`);
  }
  const cwd = typeof body.cwd === 'string' && body.cwd.length > 0 ? body.cwd : undefined;
  const sessionDir = typeof body.sessionDir === 'string' && body.sessionDir.length > 0
    ? body.sessionDir
    : undefined;
  const binary = typeof body.binary === 'string' && body.binary.length > 0
    ? body.binary
    : undefined;
  // Optional roomId — if present, the handle is tagged for the room-scoped
  // bring-in listing (dogfood finding #4, 2026-05-24). Doesn't gate spawn.
  const roomId = typeof body.roomId === 'string' && body.roomId.length > 0
    ? body.roomId
    : undefined;

  let handle: ReturnType<typeof startCliAgent>;
  try {
    handle = startCliAgent({ cli: cli as CliAgentKind, cwd, sessionDir, binary, roomId });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw error(500, `failed to spawn ${cli}: ${message}`);
  }
  return json(serialiseAgent(handle), { status: 201 });
};
