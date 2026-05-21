/**
 * POST /api/terminals/[id]/context-fill
 *   Body: { fill: number (0..1), source: string }
 *   Auth: admin-bearer
 *
 * Write-side for the per-CLI context-fill probe (JWPK msg_vz19pvkajk
 * 2026-05-19). External scripts (Claude status-line, Codex jsonrpc, pi
 * --mode rpc, etc.) compute their CLI's context % and POST here. The
 * value lands on terminals.agent_context_fill; the agent-statuses feed
 * reads it under a 5-minute freshness window so the AgentContextChip
 * surfaces the % on the always-visible footer.
 *
 * Read is via GET /api/chat-rooms/[roomId]/agent-statuses (existing).
 * Source is a free-form tag identifying the probe ('claude-statusline',
 * 'codex-jsonrpc', etc.) so future writers can prefer authoritative
 * inputs over speculative ones.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getTerminalById, setAgentContextFill } from '$lib/server/terminalsStore';

export const POST: RequestHandler = async ({ params, request }) => {
  requireAdminAuth(request);
  const id = params.id ?? '';
  if (id.length === 0) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');

  const fillRaw = body.fill;
  if (typeof fillRaw !== 'number' || !Number.isFinite(fillRaw) || fillRaw < 0 || fillRaw > 1) {
    throw error(400, 'fill must be a number in [0, 1].');
  }
  const sourceRaw = body.source;
  if (typeof sourceRaw !== 'string' || sourceRaw.trim().length === 0) {
    throw error(400, 'source must be a non-empty string identifying the probe.');
  }

  const ok = setAgentContextFill(id, fillRaw, sourceRaw.trim());
  if (!ok) throw error(500, 'failed to persist context-fill.');
  return json({ ok: true, terminalId: id, fill: fillRaw, source: sourceRaw.trim() });
};
