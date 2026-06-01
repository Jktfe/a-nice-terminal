/**
 * chatRoomAuthGate — shared identity gate for MUTATING chat-room sub-routes.
 *
 * Lifted from src/routes/api/chat-rooms/[roomId]/messages/+server.ts
 * (resolveMessageAuthorHandle) per the LAUNCH-BLOCKER CVE FIX C audit
 * (Finding #3, 2026-05-20). The audit caught that name / archive / decks /
 * artefacts / room-DELETE / and many other chat-room sub-routes accepted
 * mutations without any identity verification — anyone able to reach the
 * server could rename, archive, soft-delete, or create artefacts in any
 * chat room.
 *
 * This helper wraps resolveCallerIdentityStrict (authGate.ts) and adds an
 * ANT_ADMIN_TOKEN Bearer fallback so CLI/automation paths keep working:
 *
 *   1. ANT_ADMIN_TOKEN Bearer header  → succeeds (handle returned: '@admin')
 *   2. antchat Bearer (Mac app)        → handle from token store
 *   3. ant_browser_session cookie      → handle bound to this room
 *   4. pidChain (CLI / agent process)  → server-resolved handle
 *   5. else → 401 "auth required"
 *
 * Why a wrapper instead of calling resolveCallerIdentityStrict directly:
 *   - admin bearer fallback (Finding #3 verification requires admin path
 *     to keep working for CLI/automation).
 *   - returns the resolved handle for routes that want to stamp createdBy /
 *     postedByHandle / etc. without a separate identity lookup.
 *   - centralises the 401-vs-403 contract so all the audited sub-routes
 *     return 401 on no-auth (per the audit's curl smoke-probe spec).
 *
 * Routes that need to enforce room-membership ON TOP of identity should
 * resolve the handle here, then call getTerminalIdByHandle / similar after
 * the gate succeeds.
 */
import { error } from '@sveltejs/kit';
import { timingSafeEqual } from 'crypto';
import {
  bearerTokenFromHeader,
  resolveToken as resolveAntchatToken,
  userShapeForEmail as antchatUserShapeForEmail
} from './antchatAuthStore';
import { parsePidChainFromBody, resolveServerSideHandle } from './identityGate';
import {
  resolveBrowserSessionSecret,
  resolveBrowserSessionSecretIgnoringRoom,
  touchBrowserSessionLastSeen
} from './browserSessionStore';
import { getCookieValuesFromRequest } from './authGate';
import { resolveHumanOwnership } from './consentGate';
import { isHandleMemberOfRoom, findChatRoomById } from './chatRoomStore';
import { buildPermissionDeniedPayload } from './permissionDeniedPayload';
import { resolveApproversFor } from './permissionApproverResolver';

/** Sentinel handle attributed to admin-bearer callers. Mirrors the
 *  CLI/automation convention used by other admin-gated routes. */
export const ADMIN_BEARER_HANDLE = '@admin';

export type ChatRoomMutationAuthResult = {
  /** The resolved handle for the caller, or '@admin' for admin-bearer. */
  handle: string;
  /** True when the caller authenticated via ANT_ADMIN_TOKEN Bearer. Some
   *  routes need this to skip per-room-membership checks. */
  isAdminBearer: boolean;
};

/**
 * Try the ANT_ADMIN_TOKEN Bearer header. Returns true iff the supplied
 * token matches in constant time. Mirrors chatInviteAuth.requireAdminAuth
 * exactly so the two paths stay aligned.
 *
 * Unlike chatInviteAuth.requireAdminAuth, this helper DOES NOT 503 when
 * ANT_ADMIN_TOKEN is unset — the caller will fall through to the other
 * identity paths (cookie / pidChain / antchat). That keeps non-admin auth
 * working when the operator hasn't configured admin tokens at all.
 */
export function tryAdminBearer(request: Request): boolean {
  const configured = process.env.ANT_ADMIN_TOKEN;
  if (!configured || configured.length === 0) return false;
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (supplied.length === 0) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Pull the body-declared authorHandle (if any) so the admin-bearer branch
 * can reject human-impersonation attempts. Returns the trimmed handle or
 * null if no usable authorHandle field is present. Mirrors the messages-
 * route extraction shape; intentionally lenient (any object with a string
 * authorHandle) so we catch declared handles across all chat-room sub-route
 * body shapes.
 */
function extractAuthorHandleFromBody(rawBody: unknown): string | null {
  if (!rawBody || typeof rawBody !== 'object') return null;
  const raw = (rawBody as { authorHandle?: unknown }).authorHandle;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Try the antchat Mac-app Bearer-token header. Returns the resolved handle
 * or null if no valid antchat token is present.
 */
function tryAntchatBearer(request: Request): string | null {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;
  const record = resolveAntchatToken(token);
  if (!record) return null;
  return antchatUserShapeForEmail(record.email).handle;
}

/**
 * Resolve the caller identity for a MUTATING chat-room sub-route. Throws
 * 401 if none of the auth paths succeed. Cookie-present-but-invalid does
 * NOT 403 here — it falls through to pidChain and finally 401 so the route
 * smoke-probe in the audit spec returns a clean unauthenticated signal.
 *
 * Use this helper for: name / archive / artefacts / decks / room-DELETE /
 * docs / file-refs / agent-events / claims / responders / mode /
 * focus-mode / prompts / aliases / attachments / breaks / composer-draft /
 * tasks (write paths) / reactions / etc. — every mutating sub-route that
 * doesn't already gate via a specific helper (operator-invites,
 * browser-session, join-with-token, messages, discussions, screenshots,
 * chair, members).
 *
 * @param roomId    the chat-room id (used to scope cookie resolution)
 * @param request   the incoming Request
 * @param rawBody   the parsed JSON body (or null/undefined for GET-style writes)
 */
export function requireChatRoomMutationAuth(
  roomId: string,
  request: Request,
  rawBody: unknown
): ChatRoomMutationAuthResult {
  // Step 1: admin-bearer (CLI/automation path).
  if (tryAdminBearer(request)) {
    // T7 of plan_consent_gate_2026_05_20 (JWPK-locked): the admin-bearer
    // fast path used to accept ANY authorHandle the caller declared in the
    // body — that was the spoof that triggered JWPK's "FFS - you posted as
    // me" (lh5ci6rrwr). Reject admin-bearer writes that attribute to a
    // registered human handle (e.g. @james / @you). Admin-bearer still
    // works for any non-human handle (agent / unregistered), and continues
    // to attribute to @admin when no authorHandle is declared at all.
    const declaredHandle = extractAuthorHandleFromBody(rawBody);
    if (declaredHandle && declaredHandle !== ADMIN_BEARER_HANDLE) {
      const ownership = resolveHumanOwnership(declaredHandle);
      if (ownership.kind === 'human') {
        // Stage A: wrap with the structured permission_denied payload while
        // preserving the legacy `message: 'admin_cannot_impersonate_human'`
        // field so the existing audit-of-impersonation tests + alerting
        // continue to match on the sentinel string. New consumers read the
        // permission_denied block; old consumers keep working.
        const room = findChatRoomById(roomId);
        throw error(
          403,
          buildPermissionDeniedPayload({
            action: 'chat.impersonate_human',
            target_kind: 'room',
            target_id: roomId,
            target_display_name: room?.name,
            reason: 'human_consent_required',
            grantee_handle: declaredHandle,
            approvers: resolveApproversFor({ targetKind: 'room', targetId: roomId }),
            message: 'admin_cannot_impersonate_human'
          })
        );
      }
    }
    return { handle: ADMIN_BEARER_HANDLE, isAdminBearer: true };
  }
  // Step 2: antchat Mac-app bearer.
  const antchatHandle = tryAntchatBearer(request);
  if (antchatHandle) {
    return { handle: antchatHandle, isAdminBearer: false };
  }
  // Step 3: browser-session cookie (room-scoped).
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  for (const cookieSecret of cookieSecrets) {
    const resolved = resolveBrowserSessionSecret(cookieSecret, roomId);
    if (resolved) {
      touchBrowserSessionLastSeen(resolved.session_id);
      return { handle: resolved.handle, isAdminBearer: false };
    }
  }
  // Step 3b: browser-session cookie ignoring room scope + membership
  // check. JWPK msg_athx11bshr 2026-05-28 antV4: /rooms delete/archive
  // failed silently because browser sessions are minted scoped to ONE
  // room (resolveBrowserSessionSecret enforces session.room_id ===
  // roomId), but the rooms-list page lets users act on any room they
  // are a member of. Without this fallback, deleting a room from
  // /rooms returned 401 with no UI feedback. The membership check
  // preserves the security model — you can still only act on rooms
  // where you have a chat_room_members row — but the cookie no longer
  // has to be bound to that specific room first.
  for (const cookieSecret of cookieSecrets) {
    const resolved = resolveBrowserSessionSecretIgnoringRoom(cookieSecret);
    if (resolved && isHandleMemberOfRoom(roomId, resolved.handle)) {
      touchBrowserSessionLastSeen(resolved.session_id);
      return { handle: resolved.handle, isAdminBearer: false };
    }
  }
  // Step 4: pidChain (CLI / agent process).
  const pidChain = parsePidChainFromBody(rawBody);
  const pidChainHandle = resolveServerSideHandle(roomId, pidChain);
  if (pidChainHandle) {
    return { handle: pidChainHandle, isAdminBearer: false };
  }
  // Step 5: no identity → 401.
  console.warn(
    `[chat-room-auth] mutating request rejected room=${roomId} reason=no-identity`
  );
  throw error(401, 'Authentication required.');
}
