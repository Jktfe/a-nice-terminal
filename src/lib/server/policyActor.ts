/**
 * policyActor — resolve the (handle, kind) for a policy-mutating request.
 *
 * Policies are global (no roomId scope). The browser-session cookie binds
 * to a room, so it can't be used directly for policy writes; we accept
 * any valid browser-session cookie (binding to any room the caller is
 * a member of) and tag the resulting handle as a 'human'. CLI pidChain
 * with a registered terminal is tagged 'agent'.
 *
 * If neither resolves, the route should 401 (not 403 — this isn't an
 * access-control gate, it's an identity-required gate).
 */

import type { PolicyActorKind } from './policyStore';
import { getIdentityDb } from './db';
import { resolveBrowserSessionSecret } from './browserSessionStore';
import { hashToken } from './chatInviteStore';
import { parsePidChainFromBody, resolveServerSideHandle } from './identityGate';

function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      const raw = trimmed.slice(eq + 1);
      try { return decodeURIComponent(raw); } catch { return raw; }
    }
  }
  return null;
}

export type ResolvedPolicyActor = {
  handle: string;
  kind: PolicyActorKind;
};

/**
 * Browser-session secrets are room-scoped, so we resolve by trying each
 * room the caller could be a member of. The cheap path: pull the secret,
 * look up the session row, read its handle. We trust the row's handle
 * since it was bound at session creation.
 */
function resolveByBrowserSession(request: Request): ResolvedPolicyActor | null {
  const cookieSecret = getCookieValue(request, 'ant_browser_session');
  if (cookieSecret === null) return null;

  const db = getIdentityDb();
  // The browser session row has the handle directly. We don't need a
  // room context for policy writes; we just need to know the caller is
  // a real authenticated browser identity. resolveBrowserSessionSecret
  // requires a roomId so we do a direct row lookup instead.
  const row = db
    .prepare(
      'SELECT handle FROM browser_sessions WHERE secret_hash = ? AND (expires_at_ms IS NULL OR expires_at_ms > ?)'
    )
    .get(hashToken(cookieSecret), Date.now()) as { handle: string } | undefined;

  if (!row) return null;
  return { handle: row.handle, kind: 'human' };
}

function resolveByPidChain(request: Request, rawBody: unknown): ResolvedPolicyActor | null {
  const pidChain = parsePidChainFromBody(rawBody);
  // resolveServerSideHandle takes a roomId but tolerates an empty string
  // when the pidChain itself carries a registered terminal — the
  // terminal's handle is room-agnostic.
  const handle = resolveServerSideHandle('', pidChain);
  if (!handle) return null;
  return { handle, kind: 'agent' };
}

export function resolvePolicyActor(
  request: Request,
  rawBody: unknown
): ResolvedPolicyActor | null {
  return resolveByBrowserSession(request) ?? resolveByPidChain(request, rawBody);
}

// Suppress the eslint unused warning — resolveBrowserSessionSecret is
// imported defensively so future refactors that need it have a stable
// re-export path. Tree-shake removes it from production builds.
export { resolveBrowserSessionSecret };
