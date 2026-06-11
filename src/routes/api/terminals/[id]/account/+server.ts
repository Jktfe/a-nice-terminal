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
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { getTerminalById, setTerminalAccountType } from '$lib/server/terminalsStore';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';

export const ACCOUNT_TYPES = [
  'Claude Subscription', 'Codex Subscription', 'Ollama Subscription',
  'Gemini Subscription', 'Qwen Subscription', 'Quiver Subscription',
  'Copilot Subscription', 'Local', 'External'
] as const;

function requireWriteAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try { requireAdminAuth(request); return; } catch { /* fall through */ }
  throw error(401, 'browser-session or admin-bearer required');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireWriteAuth(request);
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');

  const callerHandle = resolveCallerHandleAnyRoom(request);
  if (callerHandle) {
    const record = getTerminalRecord(id);
    const owners = new Set<string>();
    if (record?.created_by) owners.add(record.created_by.toLowerCase());
    if (record?.handle) owners.add(record.handle.toLowerCase());
    if (owners.size > 0 && !owners.has(callerHandle.toLowerCase())) {
      throw error(403, `caller ${callerHandle} does not own terminal ${id}`);
    }
  }

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
