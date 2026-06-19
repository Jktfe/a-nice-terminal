/**
 * /api/cli-agents/[handleId]/command — send an RPC command to a live
 * bridge (CLI-HOOK-BRIDGE Phase 5, 2026-05-15).
 *
 * POST body shapes:
 *   codex: { method: string, params?: unknown }
 *   pi:    { type: string, ...command-specific fields }
 *
 * Returns: { result } from the bridge's underlying RPC. 500 if the
 * bridge rejects the command.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCliAgent } from '$lib/server/cliAgentRegistry';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  requireOperatorLikeAuth(request);
  const handle = getCliAgent(params.handleId ?? '');
  if (!handle) throw error(404, 'unknown agent handle');

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

  try {
    const result = await handle.sendCommand(body);
    return json({ result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw error(500, `command failed: ${message}`);
  }
};
