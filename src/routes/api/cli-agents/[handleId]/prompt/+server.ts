/**
 * POST /api/cli-agents/[handleId]/prompt — operator-facing prompt channel
 * for a live CLI-agent bridge.
 *
 * Closes dogfood load-bearing finding #6 (2026-05-24,
 * docs/research/dogfood-codex-yolo-2026-05-24.md): the bring-in-LLM contract
 * specced an input affordance but only the spawn endpoint shipped. Without
 * this surface, an operator who spawned a codex via /cli-agents had no way
 * to deliver a brief — the dogfood premise itself was uncompletable.
 *
 * Body: { text: string }
 *   - codex: wraps thread/start (lazy) + turn/start so callers don't need
 *     to know the JSON-RPC method names.
 *   - pi:    not yet implemented — handle throws.
 *
 * Returns: { threadId } where threadId is the codex thread the prompt was
 * dispatched into (null for non-codex bridges).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCliAgent } from '$lib/server/cliAgentRegistry';

export const POST: RequestHandler = async ({ params, request }) => {
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

  const text = typeof body.text === 'string' ? body.text : '';
  if (text.trim().length === 0) {
    throw error(400, '`text` is required and must be a non-empty string');
  }

  try {
    const result = await handle.sendPrompt(text);
    return json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw error(500, `prompt failed: ${message}`);
  }
};
