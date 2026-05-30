/**
 * PATCH /api/terminals/[id]/model — set or clear the per-terminal
 * model flag. JWPK msg_fespxsi2lu + msg_05lh00n3wg antV4 2026-05-28.
 *
 * Body: { model: string | null }
 *   - non-empty string → store as the terminal's tag (trimmed)
 *   - null OR empty string → clear back to "unspecified"
 *
 * Auth: admin-bearer OR browser-session for the terminal owner (same
 * ownership check as /settings — prevents an authenticated caller
 * from flipping someone else's terminal's model tag).
 *
 * Why a dedicated endpoint vs adding to /settings: `model` is a
 * first-class terminals column (not a meta JSON field), and the
 * /settings endpoint's `field`/`value` shape already enumerates the
 * meta-bag keys it accepts. Branching it on `field === 'model'`
 * would mix concerns; a tiny dedicated route is cheaper to read.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { getTerminalById, setTerminalModel } from '$lib/server/terminalsStore';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';

function requireWriteAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session or admin-bearer required');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireWriteAuth(request);
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');

  // Mirror the /settings IDOR fix (msg_53bpcfqe9j): when the caller is
  // session-authed, they must own the terminal. Admin-bearer bypasses.
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

  const body = (await request.json().catch(() => null)) as { model?: unknown } | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  if (body.model !== null && typeof body.model !== 'string') {
    throw error(400, 'model must be a string or null.');
  }
  const ok = setTerminalModel(id, body.model);
  if (!ok) throw error(404, 'terminal not found.');
  return json({ ok: true });
};
