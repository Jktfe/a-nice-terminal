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
import { getCookieValuesFromRequest } from './authGate';
import { parsePidChainFromBody, resolveServerSideHandle } from './identityGate';

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
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  if (cookieSecrets.length === 0) return null;

  const db = getIdentityDb();
  // The browser session row has the handle directly. We don't need a
  // room context for policy writes; we just need to know the caller is
  // a real authenticated browser identity. resolveBrowserSessionSecret
  // requires a roomId so we do a direct row lookup instead.
  const lookup = db.prepare(
    'SELECT handle FROM browser_sessions WHERE secret_hash = ? AND (expires_at_ms IS NULL OR expires_at_ms > ?)'
  );
  const now = Date.now();

  for (const cookieSecret of cookieSecrets) {
    const row = lookup.get(hashToken(cookieSecret), now) as { handle: string } | undefined;
    if (row) return { handle: row.handle, kind: 'human' };
  }
  return null;
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
