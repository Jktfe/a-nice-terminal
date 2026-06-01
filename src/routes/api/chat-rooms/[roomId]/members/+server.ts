/**
 * Members of one chat room.
 *
 *   POST   /api/chat-rooms/:roomId/members
 *     body { agentHandle, agentDisplayName? }
 *     → 201 { chatRoom } and emits "@x joined this room" system message
 *     → 400 on missing/malformed body, unknown room (legacy 400 shape),
 *           or store-level rejection
 *
 *   DELETE /api/chat-rooms/:roomId/members?globalHandle=@x
 *     → 204 and emits "@x was removed from this room" system message
 *     → 404 unknown room or non-member handle
 *     → 400 missing globalHandle query param
 *     → 409 when the target is the creator or the last human in the room
 *
 * Backs M02 invite-an-agent (board UK7Pq) and M03 slice 5 destructive remove
 * (board WTHef fe33). DELETE mirrors the fail-closed pattern from M12 breaks
 * and M03 slice 1 aliases.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  inviteAgentToRoom,
  inviteHumanToRoom,
  removeMemberFromRoom,
  findChatRoomById,
  CannotRemoveRoomMemberError
} from '$lib/server/chatRoomStore';
import { removeRoomAlias } from '$lib/server/chatRoomAliasStore';
import { buildPermissionDeniedPayload } from '$lib/server/permissionDeniedPayload';
import { resolveApproversFor } from '$lib/server/permissionApproverResolver';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { recordParticipation } from '$lib/server/chatRoomParticipationHistoryStore';
import { resolveCallerIdentityOrDeprecate, buildStaleBrowserCookieClearHeader } from '$lib/server/authGate';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { findTerminalRecordByHandle } from '$lib/server/terminalRecordsStore';
import { addMembership, removeMembership } from '$lib/server/roomMembershipsStore';
import {
  mirrorAddMembership,
  mirrorRemoveMembership
} from '$lib/server/v02ChatRoomBridge';
import {
  findAccountsOrgMemberByHandle,
  listAccountsOrgMembersForRequest,
  listLocalLicensedOrgMembers
} from '$lib/server/accountsOrgMembers';

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) {
    throw error(404, 'Room not found.');
  }
}

function assertMemberOfRoom(roomId: string, globalHandle: string): void {
  const room = findChatRoomById(roomId);
  const isMember = room?.members.some((member) => member.handle === globalHandle) ?? false;
  if (!isMember) {
    throw error(404, `${globalHandle} is not a member of this room.`);
  }
}

function normaliseToAtHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) return trimmed;
  return `@${trimmed}`;
}

async function listOrgMembersForInviteRequest(request: Request) {
  return (await listAccountsOrgMembersForRequest(request)) ?? listLocalLicensedOrgMembers();
}

export const GET: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);

  const orgMembers = await listOrgMembersForInviteRequest(request);
  const roomHandles = new Set(room.members.map((member) => member.handle.toLowerCase()));
  return json({
    orgId: orgMembers.orgId,
    members: orgMembers.members.map((member) => ({
      ...member,
      inRoom: roomHandles.has(normaliseToAtHandle(member.handle).toLowerCase())
    }))
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with an agentHandle or handle field.');
  }

  const humanHandle = (rawBody as { handle?: unknown; humanHandle?: unknown }).handle ??
    (rawBody as { humanHandle?: unknown }).humanHandle;
  if (typeof humanHandle === 'string') {
    const room = findChatRoomById(params.roomId);
    if (!room) throw error(404, 'Room not found.');
    await requireChatRoomReadAccess(request, room);

    const orgMembers = await listOrgMembersForInviteRequest(request);
    const teammate = findAccountsOrgMemberByHandle(orgMembers.members, humanHandle);
    if (!teammate) {
      // Stage A 403 PermissionDenied payload — wrap with structured
      // approver hint while preserving the legacy message string so
      // existing tests + audit log filters keep matching.
      throw error(
        403,
        buildPermissionDeniedPayload({
          action: 'room.invite_human',
          target_kind: 'room',
          target_id: params.roomId,
          target_display_name: room.name,
          reason: 'not_org_admin',
          grantee_handle: humanHandle,
          approvers: resolveApproversFor({
            targetKind: 'room',
            targetId: params.roomId
          }),
          message: 'target handle is not in your organisation.'
        })
      );
    }

    const normalisedHumanHandle = normaliseToAtHandle(teammate.handle);
    const existingMember = room.members.find(
      (member) => member.handle === normalisedHumanHandle
    );
    if (existingMember) {
      throw error(409, `${normalisedHumanHandle} is already a member of this room.`);
    }

    const updatedRoom = inviteHumanToRoom({
      roomId: params.roomId,
      humanHandle: normalisedHumanHandle,
      humanDisplayName: teammate.displayName
    });
    // M9c dual-write: mirror the human invite into v02_memberships so the
    // v0.2 substrate reflects the same roster. Best-effort; legacy 200
    // response shape is preserved on mirror failure.
    mirrorAddMembership({
      roomId: params.roomId,
      handle: normalisedHumanHandle,
      displayName: teammate.displayName ?? normalisedHumanHandle
    });
    postSystemMessage({
      roomId: params.roomId,
      body: `${normalisedHumanHandle} joined this room.`
    });
    recordParticipation({ globalHandle: normalisedHumanHandle, roomId: params.roomId });
    return json({ chatRoom: updatedRoom, member: teammate }, { status: 200 });
  }

  const agentHandle = (rawBody as { agentHandle?: unknown }).agentHandle;
  if (typeof agentHandle !== 'string') {
    throw error(400, 'agentHandle must be a string.');
  }
  const normalisedAgentHandle = normaliseToAtHandle(agentHandle);

  // M3.6a-v1 T2: identity gate on invite-an-agent. Cookie-first → pidChain →
  // deprecation gate (warning header today, strict 403 after cutover).
  const auth = resolveCallerIdentityOrDeprecate('members-post', params.roomId, request, rawBody);

  // INVITE-VALIDATE (2026-05-15, JWPK): participants must bind to a real
  // terminal — refuse free-form handles that don't resolve. Without this
  // gate the form would create "ghost" members (e.g. @manual-test-bot)
  // that have no Terminals-page presence and can never be reached. Runs
  // after auth so unauthenticated callers don't probe terminal existence.
  const terminalRecord = findTerminalRecordByHandle(agentHandle);
  if (!terminalRecord) {
    throw error(
      400,
      `No such handle '${agentHandle.trim()}' — there's no terminal with this handle. Launch a terminal with this handle first.`
    );
  }

  const agentDisplayNameRaw = (rawBody as { agentDisplayName?: unknown }).agentDisplayName;
  const agentDisplayName =
    typeof agentDisplayNameRaw === 'string' ? agentDisplayNameRaw : undefined;

  try {
    const existingRoom = findChatRoomById(params.roomId);
    const existingMember = existingRoom?.members.find(
      (member) => member.handle === normalisedAgentHandle
    );
    if (existingMember) {
      // Delivery binding repair path: older invites wrote chat_room_members
      // only, which made the UI show a member but left fanout with no
      // room_memberships row. Re-inviting the same handle now idempotently
      // repairs the route-to-terminal binding instead of returning "already
      // a member" while messages still cannot reach the terminal.
      addMembership({
        room_id: params.roomId,
        handle: normalisedAgentHandle,
        terminal_id: terminalRecord.session_id
      });
      // M9c dual-write: mirror the agent rebind into v02_memberships.
      mirrorAddMembership({
        roomId: params.roomId,
        handle: normalisedAgentHandle,
        displayName: agentDisplayName ?? normalisedAgentHandle
      });
      const headers: Record<string, string> = {};
      if (auth.kind === 'legacy') headers[auth.warningHeader.name] = auth.warningHeader.value;
      if (auth.clearStaleBrowserCookie) headers['set-cookie'] = buildStaleBrowserCookieClearHeader(params.roomId);
      return json({ chatRoom: existingRoom }, { status: 200, headers });
    }

    const updatedRoom = inviteAgentToRoom({
      roomId: params.roomId,
      agentHandle: normalisedAgentHandle,
      agentDisplayName
    });
    addMembership({
      room_id: params.roomId,
      handle: normalisedAgentHandle,
      terminal_id: terminalRecord.session_id
    });
    // M9c dual-write: mirror the new agent member into v02_memberships.
    mirrorAddMembership({
      roomId: params.roomId,
      handle: normalisedAgentHandle,
      displayName: agentDisplayName ?? normalisedAgentHandle
    });
    const newMember = updatedRoom.members[updatedRoom.members.length - 1];
    postSystemMessage({
      roomId: params.roomId,
      body: `${newMember.handle} joined this room.`
    });
    recordParticipation({ globalHandle: newMember.handle, roomId: params.roomId });
    const headers: Record<string, string> = {};
    if (auth.kind === 'legacy') headers[auth.warningHeader.name] = auth.warningHeader.value;
    if (auth.clearStaleBrowserCookie) headers['set-cookie'] = buildStaleBrowserCookieClearHeader(params.roomId);
    return json({ chatRoom: updatedRoom }, { status: 201, headers });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not invite agent.';
    throw error(400, message);
  }
};

// M3.6a-v1 T2 R3: DELETE accepts optional JSON body with pidChain so the
// 3-tier gate works the same as POST/messages. Empty/missing body still
// parses to {} so the warning-phase path is available for legacy callers.
async function parseOptionalJsonBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text || text.length === 0) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export const DELETE: RequestHandler = async ({ params, url, request }) => {
  assertRoomExists(params.roomId);

  const rawHandle = url.searchParams.get('globalHandle');
  if (!rawHandle) {
    throw error(400, 'globalHandle query parameter required.');
  }

  const rawBody = await parseOptionalJsonBody(request);
  const auth = resolveCallerIdentityOrDeprecate('members-delete', params.roomId, request, rawBody);

  const globalHandle = normaliseToAtHandle(rawHandle);
  assertMemberOfRoom(params.roomId, globalHandle);

  try {
    removeMemberFromRoom({ roomId: params.roomId, globalHandle });
  } catch (causeOfFailure) {
    if (causeOfFailure instanceof CannotRemoveRoomMemberError) {
      const headers: Record<string, string> = {};
      if (auth.kind === 'legacy') headers[auth.warningHeader.name] = auth.warningHeader.value;
      if (auth.clearStaleBrowserCookie) headers['set-cookie'] = buildStaleBrowserCookieClearHeader(params.roomId);
      return json(
        { message: causeOfFailure.message, reason: causeOfFailure.reason },
        { status: 409, headers }
      );
    }
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not remove member.';
    throw error(400, message);
  }

  removeRoomAlias({ roomId: params.roomId, globalHandle });
  removeMembership(params.roomId, globalHandle);
  // M9c dual-write: soft-leave the v02_memberships row so the v0.2
  // substrate reflects the removal. Best-effort; legacy 204 path preserved.
  mirrorRemoveMembership(params.roomId, globalHandle);
  postSystemMessage({
    roomId: params.roomId,
    body: `${globalHandle} was removed from this room.`
  });

  const headers: Record<string, string> = {};
  if (auth.kind === 'legacy') headers[auth.warningHeader.name] = auth.warningHeader.value;
  if (auth.clearStaleBrowserCookie) headers['set-cookie'] = buildStaleBrowserCookieClearHeader(params.roomId);
  return new Response(null, { status: 204, headers });
};
