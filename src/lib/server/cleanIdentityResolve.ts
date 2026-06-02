/**
 * cleanIdentityResolve — server-authoritative identity resolution, point 3 of
 * the JWPK spec:
 *
 *   Identity resolves by HANDLE, server-authoritative.
 *   NO terminal-id in the identity path.
 *   NO config.json identity cache.
 *   NO "@you" sentinel.
 *   Humans and agents use the SAME model (no operator special-casing).
 *
 * resolveCaller takes what a caller presents — a durable session id and/or a
 * handle — and resolves it against the authoritative server stores ONLY:
 *   - antSessionStore  (the durable session; never a terminal-id / pid / config)
 *   - orgStore         (the handle's privilege => isSuperAdmin)
 *
 * The handle is the identity. The session id is the durable runtime token that
 * survives restarts (read straight from ant_sessions). Nothing here reads a
 * terminal id, a pid, or any client-side cache.
 *
 * NEW standalone module built to be cut over to. Does NOT touch the legacy
 * resolvers / gates / register.
 */

import { getIdentityDb } from './db';
import { getSession } from './antSessionStore';
import { isSuperAdmin } from './orgStore';

export type ResolvedCaller = {
  /** The identity. Always present on a successful resolve. */
  handle: string;
  /** The durable session the caller resolves to, or null if no session was
   *  presented / resolvable. Identity does NOT depend on this — a known handle
   *  with no live session still resolves (the session is the runtime, not the
   *  identity). */
  sessionId: string | null;
  /** Server-authoritative privilege check (orgStore). */
  isSuperAdmin: boolean;
};

export type ResolveCallerInput = {
  /** A durable ant_sessions id the caller presents (e.g. its persisted token).
   *  Resolved against antSessionStore; never a terminal/pid. */
  sessionId?: string | null;
  /** The handle the caller claims to be. This is the identity key. */
  handle?: string | null;
};

/**
 * Resolve the calling identity, server-authoritatively.
 *
 * Resolution rules (handle is the identity):
 *  1. If a sessionId is presented, it MUST resolve to a real ant_sessions row
 *     (server-authoritative); an unknown/expired session id is NOT trusted.
 *  2. A handle may be supplied directly (the identity claim). If both a handle
 *     and a session-derived label are available, the explicit handle wins as
 *     the identity; the session supplies only the durable sessionId.
 *  3. At least one of {a resolvable session, a handle} must be present, else
 *     there is no identity to resolve -> null.
 *
 * Returns null when nothing resolves. Never throws on unknown input.
 */
export function resolveCaller(input: ResolveCallerInput, db = getIdentityDb()): ResolvedCaller | null {
  const presentedHandle = normaliseHandle(input.handle);

  let sessionId: string | null = null;
  if (input.sessionId) {
    const session = getSession(input.sessionId, db);
    if (session) {
      // Authoritative: only trust a session id that resolves to a real row.
      sessionId = session.id;
    }
  }

  // The identity is the handle. With no handle and no resolvable session there
  // is nothing to resolve.
  const handle = presentedHandle;
  if (handle === null && sessionId === null) return null;

  // A session with no handle is a runtime without a claimed identity in this
  // clean model (handle-keyed). We cannot mint an identity from a terminal/pid
  // (spec point 3), so without a handle there is no caller identity to return.
  if (handle === null) return null;

  return {
    handle,
    sessionId,
    isSuperAdmin: isSuperAdmin(handle, undefined, db)
  };
}

/**
 * Whether a handle may manage room memberships (add/remove members in ANY
 * room). Per the spec, a SuperAdmin can edit any room's membership; nothing
 * special-cases the human operator beyond holding the superadmin privilege.
 */
export function canManageMemberships(handle: string, db = getIdentityDb()): boolean {
  return isSuperAdmin(handle, undefined, db);
}

/** Trim + reject the "@you" sentinel (spec: NO "@you") and empties. */
function normaliseHandle(handle: string | null | undefined): string | null {
  if (handle == null) return null;
  const trimmed = handle.trim();
  if (trimmed === '') return null;
  if (trimmed === '@you' || trimmed === 'you') return null;
  return trimmed;
}
