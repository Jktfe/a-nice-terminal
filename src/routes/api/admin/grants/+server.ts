/**
 * /api/admin/grants — caller_grants admin surface (slice 3b/4 of caller_grants).
 *
 * JWPK msg_hf8ziydn4r + msg_zmqhwh5tpx (2026-05-19).
 *
 * POST   /api/admin/grants — issue a human or agent grant.
 *   Body (human):  { kind: 'human', pid, pid_start, expiresInMs, password? }
 *   Body (agent):  { kind: 'agent', pid, pid_start, handle, tmux_session_id? }
 *   Auth:          admin-bearer (loopback-only deploy model — only the
 *                  operator who has the secrets.env token can issue grants)
 *   201 → { grant: CallerGrant }
 *
 * GET    /api/admin/grants → { grants: CallerGrant[] }  (active only)
 *
 * DELETE /api/admin/grants?id=<grantId> — revoke a specific grant.
 *   200 → { revoked: boolean }
 *
 * The CLI verbs `ant granthuman` / `ant grantagent` / `ant revokegrant`
 * (slice 4) call into this endpoint with the admin-bearer from
 * ~/.ant/secrets.env. Browser POSTs are NOT supported here — granting is
 * a high-trust action that should require explicit operator intent via CLI,
 * not a stray browser fetch.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  grantHumanGrant,
  grantAgentGrant,
  listActiveGrants,
  revokeGrant
} from '$lib/server/callerGrantsStore';

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  const kind = body.kind;
  if (kind !== 'human' && kind !== 'agent') {
    throw error(400, 'kind must be "human" or "agent".');
  }
  const pid = typeof body.pid === 'number' && Number.isFinite(body.pid) && body.pid > 0
    ? Math.floor(body.pid)
    : null;
  const pidStart = typeof body.pid_start === 'string' && body.pid_start.length > 0
    ? body.pid_start
    : null;
  if (pid === null || pidStart === null) {
    throw error(400, 'pid (positive integer) and pid_start (string) are required.');
  }
  const grantedByHandle = typeof body.granted_by_handle === 'string'
    ? body.granted_by_handle
    : '@you';
  const tmuxSessionId = typeof body.tmux_session_id === 'string' ? body.tmux_session_id : null;
  if (kind === 'human') {
    const expiresInMs = typeof body.expires_in_ms === 'number' && Number.isFinite(body.expires_in_ms) && body.expires_in_ms > 0
      ? Math.floor(body.expires_in_ms)
      : null;
    if (expiresInMs === null) {
      throw error(400, 'human grants require expires_in_ms (positive integer milliseconds).');
    }
    const passwordVerified = body.password_verified === true ? Date.now() : null;
    const grant = grantHumanGrant({
      pid,
      pidStart,
      expiresAtMs: Date.now() + expiresInMs,
      grantedByHandle,
      passwordVerifiedAtMs: passwordVerified,
      tmuxSessionId
    });
    return json({ grant }, { status: 201 });
  }
  // agent
  const handle = typeof body.handle === 'string' && body.handle.length > 0
    ? body.handle
    : null;
  if (handle === null) {
    throw error(400, 'agent grants require handle (string, e.g. @evolveantfoo).');
  }
  const grant = grantAgentGrant({
    pid,
    pidStart,
    handle: handle.startsWith('@') ? handle : `@${handle}`,
    grantedByHandle,
    tmuxSessionId
  });
  return json({ grant }, { status: 201 });
};

export const GET: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  return json({ grants: listActiveGrants() });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
  requireAdminAuth(request);
  const id = url.searchParams.get('id');
  if (!id || id.length === 0) throw error(400, 'id query parameter required.');
  const revoked = revokeGrant(id);
  return json({ revoked });
};
