/**
 * POST /api/chat-rooms/:roomId/members/:handle/reclaim
 *
 * Phase C2 of the 0.1.13 terminal lifecycle slice (JWPK A Team
 * msg_7uvr35x0xr, greenlit 2026-05-29). Flips the terminal bound to a
 * room membership from `archived` back to `live` so the handle becomes
 * usable again without forcing the operator to re-register from
 * scratch.
 *
 * Behaviour:
 *   1. Read-gate via requireChatRoomReadAccess — caller must be
 *      authenticated and have access to the room. Anything else 401/404s.
 *   2. Look up the room_memberships row for (roomId, handle). 404 if
 *      missing — there's nothing to reclaim.
 *   3. Resolve the bound terminal. 404 if the row points at a terminal
 *      that no longer exists (stale fk).
 *   4. If already 'live' → 200 with { ok:true, alreadyLive:true }.
 *      Idempotent so the participants pane can fire on click without
 *      checking server-side state first.
 *   5. If 'deleted' → 409. Deleted is intentional, not recoverable here;
 *      the caller has to register a fresh terminal.
 *   6. **Authorization gate** (2026-05-30 security fix — HIGH finding
 *      raised in the post-cutover security review). A rebind to the
 *      caller's terminal is account-takeover-shaped: it lets the caller
 *      impersonate the previous holder of the handle in this room. To
 *      authorise a rebind the caller MUST satisfy ONE of:
 *        (a) admin-bearer (`access.isAdminBearer`),
 *        (b) room owner (`access.handles` covers `room.whoCreatedIt`),
 *        (c) self-reclaim — the caller's terminal record's
 *            `handle_aliases` contains the target handle (i.e. they
 *            previously held it and want to take it back after a rename
 *            or archive).
 *      Status-only flips (no rebind) require the same gate to prevent
 *      reviving someone else's archived terminal without consent.
 *      Failure returns 403 with the Stage A structured
 *      `permission_denied` payload naming the room owner as approver.
 *   7. Resolve the caller's pidChain to a live terminal. If the resolved
 *      terminal differs from the bound one, re-point membership.terminal_id
 *      to the caller's terminal (via addMembership's upsert) AND flip
 *      the caller's terminal status to 'live' (in case it was archived).
 *      If they're the same, just flip the bound terminal to 'live'.
 *   8. Post a system message into the room so every reclaim is visible
 *      to all participants — silent hijack becomes detectable. Returns
 *      200 with { ok:true, terminalId, repointed?:boolean }.
 *
 * pidChain comes from the request body (standard ANT CLI pattern,
 * matches identity-gated POST routes). When the caller's pidChain
 * doesn't resolve, the bound terminal can still be flipped to 'live'
 * — but ONLY if the authorisation gate allows it.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  requireChatRoomReadAccess,
  type ChatRoomReadAccess
} from '$lib/server/chatRoomReadGate';
import { parsePidChainFromBody } from '$lib/server/identityGate';
import {
  addMembership,
  getTerminalIdByHandle
} from '$lib/server/roomMembershipsStore';
import {
  getTerminalById,
  lookupTerminalByPidChain,
  setTerminalStatus,
  type TerminalRow
} from '$lib/server/terminalsStore';
import { getHandleAliases } from '$lib/server/terminalRecordsStore';
import { buildPermissionDeniedPayload } from '$lib/server/permissionDeniedPayload';
import { postSystemMessage } from '$lib/server/chatMessageStore';

function decodeHandleParam(rawHandle: string): string {
  const decoded = decodeURIComponent(rawHandle);
  return decoded.startsWith('@') ? decoded : `@${decoded}`;
}

/**
 * Resolve whether the caller is authorised to reclaim `targetHandle` in
 * the given room. Returns a short reason tag the audit row + the 403
 * payload can carry so reviewers can trace each successful reclaim back
 * to the privilege that allowed it.
 */
type ReclaimAuthOutcome =
  | { allowed: true; reason: 'admin-bearer' | 'room-owner' | 'self-reclaim-alias' }
  | { allowed: false };

export function _evaluateReclaimAuth(args: {
  access: ChatRoomReadAccess;
  roomOwnerHandle: string;
  callerTerminal: TerminalRow | null;
  targetHandle: string;
}): ReclaimAuthOutcome {
  if (args.access.isAdminBearer) return { allowed: true, reason: 'admin-bearer' };

  const ownerCandidates = new Set<string>([
    ...args.access.handles,
    ...(args.access.principalHandles ?? [])
  ]);
  if (ownerCandidates.has(args.roomOwnerHandle)) {
    return { allowed: true, reason: 'room-owner' };
  }

  if (args.callerTerminal) {
    const aliases = getHandleAliases(args.callerTerminal.id);
    if (aliases.includes(args.targetHandle)) {
      return { allowed: true, reason: 'self-reclaim-alias' };
    }
  }

  return { allowed: false };
}

function preferredCallerHandle(
  access: ChatRoomReadAccess,
  callerTerminal: TerminalRow | null
): string {
  if (access.isAdminBearer) return '@admin';
  if (access.principalHandles && access.principalHandles.length > 0) {
    return access.principalHandles[0];
  }
  if (access.handles.length > 0) return access.handles[0];
  if (callerTerminal) return `@${callerTerminal.name}`;
  return '@unknown';
}

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  // Read-gate first. 401 / 404 are thrown by the gate.
  const access = await requireChatRoomReadAccess(request, room);

  // Body is optional — only the pidChain matters for re-point logic.
  // Anything else is ignored.
  const rawBody = await request.json().catch(() => ({}));
  const pidChain = parsePidChainFromBody(rawBody);

  const targetHandle = decodeHandleParam(params.handle);
  const boundTerminalId = getTerminalIdByHandle(params.roomId, targetHandle);
  if (!boundTerminalId) throw error(404, 'Handle is not a member of this room.');

  const boundTerminal = getTerminalById(boundTerminalId);
  if (!boundTerminal) throw error(404, 'Bound terminal no longer exists.');

  const currentStatus = boundTerminal.status ?? 'live';
  if (currentStatus === 'live') {
    return json({ ok: true, alreadyLive: true, terminalId: boundTerminalId });
  }
  if (currentStatus === 'deleted') {
    throw error(409, 'Terminal is deleted — re-register a fresh terminal to take this handle.');
  }

  // Resolve caller's terminal once — needed for both the auth check
  // (self-reclaim path consults the caller's handle_aliases) and the
  // rebind path below.
  const callerTerminal = pidChain.length > 0 ? lookupTerminalByPidChain(pidChain) : null;

  // Authorisation gate — see header docstring for the full rationale.
  // Account-takeover-shaped finding from the 2026-05-30 security review.
  const authOutcome = _evaluateReclaimAuth({
    access,
    roomOwnerHandle: room.whoCreatedIt,
    callerTerminal,
    targetHandle
  });
  if (!authOutcome.allowed) {
    const approvers = [
      { handle: room.whoCreatedIt, role: 'room_owner', preferred: true }
    ];
    throw error(403, buildPermissionDeniedPayload({
      action: 'members.reclaim',
      target_kind: 'room',
      target_id: params.roomId,
      target_display_name: room.name,
      reason: 'not_room_owner',
      grantee_handle: targetHandle,
      approvers,
      message: `Only the room owner, an admin, or the previous holder of ${targetHandle} can reclaim it.`
    }));
  }

  // Phase C2 re-point: if the caller is on a different live terminal
  // (e.g. a freshly-rebuilt shell), point the membership at THAT
  // terminal and also flip its status to live in case it was archived
  // upstream. If the caller's pidChain doesn't resolve OR resolves to
  // the same terminal, just flip the bound one to live.
  const actorHandle = preferredCallerHandle(access, callerTerminal);
  if (callerTerminal && callerTerminal.id !== boundTerminalId) {
    addMembership({
      room_id: params.roomId,
      handle: targetHandle,
      terminal_id: callerTerminal.id
    });
    setTerminalStatus(callerTerminal.id, 'live');
    postSystemMessage({
      roomId: params.roomId,
      body: `${actorHandle} reclaimed ${targetHandle} (auth=${authOutcome.reason}; re-pointed terminal ${boundTerminalId} → ${callerTerminal.id})`
    });
    return json({
      ok: true,
      terminalId: callerTerminal.id,
      repointed: true,
      authReason: authOutcome.reason
    });
  }

  setTerminalStatus(boundTerminalId, 'live');
  postSystemMessage({
    roomId: params.roomId,
    body: `${actorHandle} reclaimed ${targetHandle} (auth=${authOutcome.reason}; flipped terminal ${boundTerminalId} archived → live)`
  });
  return json({
    ok: true,
    terminalId: boundTerminalId,
    authReason: authOutcome.reason
  });
};
