/**
 * PATCH /api/terminals/[id]/cli — operator-set the terminal's CLI (agent_kind)
 * for the v3 desk directory (JWPK msg_om51nvohx5 2026-06-11). Normally the
 * kind is fingerprint-detected; this lets the operator correct/assign it.
 * Body: { cli: string | null }. Picks from the editable agent-kinds list;
 * value is stored opaque (the list is the UI's source of truth).
 *
 * Operator-or-admin gated (terminal classification, no per-owner IDOR), same
 * as the account/family endpoints.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { getTerminalById, setTerminalAgentKind } from '$lib/server/terminalsStore';
import { updateTerminalRecord } from '$lib/server/terminalRecordsStore';

function requireOperatorOrAdmin(request: Request): void {
  if (tryAdminBearer(request) || tryOperatorSession(request)) return;
  throw error(401, 'admin-bearer or operator session required');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireOperatorOrAdmin(request);
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');
  const body = (await request.json().catch(() => null)) as { cli?: unknown } | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  const v = body.cli;
  if (v !== null && typeof v !== 'string') throw error(400, 'cli must be a string or null.');
  const agentKind = typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  const ok = setTerminalAgentKind(id, agentKind);
  if (!ok) throw error(404, 'terminal not found.');
  updateTerminalRecord(id, { agentKind });
  return json({ ok: true, sessionId: id, agentKind });
};
