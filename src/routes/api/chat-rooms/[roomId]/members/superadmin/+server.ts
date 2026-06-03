/**
 * SuperAdmin room-member management — the CLEAN-STORE lane.
 *
 *   POST   /api/chat-rooms/:roomId/members/superadmin   body { handle }
 *     SuperAdmin-only "add @handle to this room". Resolves the target handle
 *     to its most-recent durable ant_sessions row and claims the room handle
 *     for that session via roomHandleLeaseClean.claimHandle (no-overwrite +
 *     suffix rules enforced by the store). Returns { handle: grantedDisplay }.
 *
 *   DELETE /api/chat-rooms/:roomId/members/superadmin   body/query { handle }
 *     SuperAdmin-only "remove @handle from this room". Retires the clean
 *     (suffix-0) holder via roomHandleLeaseClean.removeHandle. Returns the
 *     @handle-N it was retired as, or 404 when there is no active clean holder.
 *
 * WHY A NEW SIBLING SUB-PATH (members/superadmin) RATHER THAN members/+server:
 *   The path members/+server.ts is ALREADY OWNED by the legacy M02/M03
 *   invite-an-agent + destructive-remove endpoint (chatRoomStore +
 *   room_memberships + v02 dual-write, with 24 tests and a [handle]/reclaim
 *   subtree). Overwriting it would silently destroy that live feature set,
 *   which the build boundary forbids ("NEW route files only; do NOT modify
 *   existing routes"). This SuperAdmin/clean-store lane therefore lives at a
 *   new, non-colliding sub-path and leaves the legacy endpoint untouched.
 *
 * AUTH (reused, not invented): caller identity is resolved with the SAME
 * extraction the other mutating chat-room sub-routes use —
 * requireChatRoomMutationAuth (chatRoomAuthGate.ts): ANT_ADMIN_TOKEN Bearer
 * (the SuperAdmin escape hatch) → antchat Bearer → ant_browser_session cookie
 * → pidChain. On top of that, this route ALSO accepts the durable-session
 * path (x-ant-session-id header / sessionId|antSessionId body field) resolved
 * through the clean cleanIdentityResolve.resolveCaller, mirroring how the
 * messages endpoint accepts an ANT session id. The SuperAdmin gate is then:
 *   isAdminBearer  ||  isSuperAdmin(callerHandle)   else 403.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireChatRoomMutationAuth, tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { isSuperAdmin } from '$lib/server/orgStore';
import { getSession } from '$lib/server/antSessionStore';
import { claimHandle, removeHandle } from '$lib/server/roomHandleLeaseClean';
import { getIdentityDb } from '$lib/server/db';

/** @-normalise to the BASE handle: trim, strip leading @, re-prefix a single @. */
function normaliseHandle(raw: string): string {
  const withoutAt = raw.trim().replace(/^@+/, '');
  return `@${withoutAt}`;
}

/** Pull a usable `handle` from the parsed body, or null. */
function handleFromBody(rawBody: unknown): string | null {
  if (!rawBody || typeof rawBody !== 'object') return null;
  const raw = (rawBody as { handle?: unknown }).handle;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The durable session id a caller presents (header first, then body). */
function callerSessionIdFrom(request: Request, rawBody: unknown): string | null {
  const fromHeader = request.headers.get('x-ant-session-id')?.trim();
  if (fromHeader) return fromHeader;
  if (rawBody && typeof rawBody === 'object') {
    const sessionId = (rawBody as { sessionId?: unknown }).sessionId;
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) return sessionId.trim();
    const antSessionId = (rawBody as { antSessionId?: unknown }).antSessionId;
    if (typeof antSessionId === 'string' && antSessionId.trim().length > 0) {
      return antSessionId.trim();
    }
  }
  return null;
}

/**
 * Resolve the caller's handle + whether they are authorised to manage room
 * memberships (SuperAdmin or admin-bearer). Reuses the shared mutating-route
 * gate for the bearer/cookie/pidChain shapes, and additionally honours the
 * durable-session path via the clean resolver. Throws 401 if no identity
 * resolves; throws 403 if the resolved identity is not a SuperAdmin.
 */
function requireSuperAdminCaller(
  roomId: string,
  request: Request,
  rawBody: unknown
): { handle: string; isAdminBearer: boolean } {
  // Admin-bearer = SuperAdmin escape hatch. Check it directly so the clean
  // SuperAdmin gate short-circuits the same way other admin-gated routes do,
  // without depending on a human-impersonation body shape.
  if (tryAdminBearer(request)) {
    return { handle: '@admin', isAdminBearer: true };
  }

  // Durable-session caller path (x-ant-session-id / sessionId / antSessionId).
  // The identity is the session's label (its @handle); resolveCaller requires
  // an explicit handle and won't infer it from the session, so we read the
  // label off the resolved ant_sessions row (server-authoritative — an
  // unresolvable session id is not trusted). getSession also ensures the
  // ant_sessions table exists for the target lookup below.
  const db = getIdentityDb();
  const callerSessionId = callerSessionIdFrom(request, rawBody);
  if (callerSessionId) {
    const callerSession = getSession(callerSessionId, db);
    const callerHandle = callerSession?.label?.trim();
    if (callerHandle && callerHandle.length > 0) {
      if (isSuperAdmin(callerHandle, undefined, db)) {
        return { handle: callerHandle, isAdminBearer: false };
      }
      throw error(403, `${callerHandle} is not a SuperAdmin.`);
    }
  }

  // Fall back to the shared mutating-route gate (antchat bearer / cookie /
  // pidChain). It throws 401 when nothing resolves.
  const auth = requireChatRoomMutationAuth(roomId, request, rawBody);
  if (auth.isAdminBearer) return auth;
  if (isSuperAdmin(auth.handle, undefined, db)) {
    return { handle: auth.handle, isAdminBearer: false };
  }
  throw error(403, `${auth.handle} is not a SuperAdmin.`);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text || text.length === 0) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export const POST: RequestHandler = async ({ params, request }) => {
  const rawBody = await parseJsonBody(request);
  requireSuperAdminCaller(params.roomId, request, rawBody);

  const rawHandle = handleFromBody(rawBody);
  if (!rawHandle) {
    throw error(400, 'Send a JSON body with a non-empty handle field.');
  }
  const handle = normaliseHandle(rawHandle);

  // Resolve the TARGET: the most-recent durable ant_sessions row whose label
  // matches the normalised @handle. No placeholder session is invented — if
  // the target has never connected, fail with a clear 409.
  const db = getIdentityDb();
  // Ensure the ant_sessions table exists (the admin-bearer path skips the
  // session resolver, so the table may not have been touched yet).
  getSession('__ensure_table__', db);
  const targetSession = db
    .prepare(
      `SELECT id FROM ant_sessions WHERE label = ? ORDER BY created_at_ms DESC, id DESC LIMIT 1`
    )
    .get(handle) as { id: string } | undefined;
  if (!targetSession) {
    // FOLLOW-UP: once a handle can be pre-provisioned without a live runtime,
    // this 409 becomes an add-then-bind flow. For now a handle must have a
    // durable session before it can be added to a room.
    throw error(
      409,
      `${handle} has no durable session yet — they must connect once before being added.`
    );
  }

  const grantedDisplay = claimHandle(params.roomId, handle, targetSession.id, db);
  return json({ handle: grantedDisplay }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, url, request }) => {
  const rawBody = await parseJsonBody(request);
  requireSuperAdminCaller(params.roomId, request, rawBody);

  const rawHandle = handleFromBody(rawBody) ?? url.searchParams.get('handle');
  if (!rawHandle || rawHandle.trim().length === 0) {
    throw error(400, 'Provide a handle in the JSON body or ?handle= query parameter.');
  }
  const handle = normaliseHandle(rawHandle);

  const retiredAs = removeHandle(params.roomId, handle, getIdentityDb());
  if (retiredAs === null) {
    throw error(404, `${handle} has no active holder in this room.`);
  }
  return json({ retiredAs }, { status: 200 });
};
