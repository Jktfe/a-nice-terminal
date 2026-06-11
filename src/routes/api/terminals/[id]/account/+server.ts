/**
 * PATCH /api/terminals/[id]/account — set or clear the per-terminal account
 * type (JWPK msg_om51nvohx5 2026-06-11). Body: { accountType: string | null }.
 * Allow-listed (the desk pane's dropdown enum); null/empty clears.
 *
 * Auth + ownership identical to the model endpoint: session-authed callers
 * must own the terminal, admin-bearer bypasses.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { getTerminalById, setTerminalAccountType } from '$lib/server/terminalsStore';

const ACCOUNT_TYPES = [
  'Claude Subscription', 'Codex Subscription', 'Ollama Subscription',
  'Gemini Subscription', 'Qwen Subscription', 'Quiver Subscription',
  'Copilot Subscription', 'Local', 'External'
] as const;

// account_type is operator-managed terminal CLASSIFICATION (like the
// catalogues it picks from), not a per-terminal-owner field — so it is gated
// to admin-bearer OR the operator's own session, exactly like
// /api/terminal-classes and /api/default-models. This deliberately replaces
// the /model endpoint's per-owner ownership check, which fails OPEN on
// terminals with no owner fields (flagged by commit review 2026-06-11); a
// fixed operator/admin gate has no IDOR surface and lets the operator
// classify any terminal, which is the point.
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

  const body = (await request.json().catch(() => null)) as { accountType?: unknown } | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  const v = body.accountType;
  if (v !== null && typeof v !== 'string') throw error(400, 'accountType must be a string or null.');
  if (typeof v === 'string' && v.length > 0 && !ACCOUNT_TYPES.includes(v as (typeof ACCOUNT_TYPES)[number])) {
    throw error(400, `accountType must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }
  const ok = setTerminalAccountType(id, v ?? null);
  if (!ok) throw error(404, 'terminal not found.');
  return json({ ok: true });
};
