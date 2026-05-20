/**
 * Chat membership binding — convert exchanged TokenIdentity to room
 * membership. Read-only consumer of chatInviteStore + chatRoomStore.
 *
 * The invite/token surface and the room-membership surface live in
 * separate baselined stores. After a client exchanges password for a
 * tokenSecret, this module is the bridge that turns the verified
 * TokenIdentity into a RoomMember on the corresponding room.
 *
 * No state, no PID-tree binding, no admin override. The handle on the
 * token is the authoritative agent identity for v1; lane-5 identity
 * routing will tighten this when it lands.
 */

import { verifyToken, type TokenIdentity } from './chatInviteStore';
import {
  findChatRoomById,
  inviteAgentToRoom,
  type ChatRoom,
  type RoomMember
} from './chatRoomStore';
import { bindRoomHandleToLiveTerminal } from './terminalHandleBinding';

export type BindResult = {
  room: ChatRoom;
  member: RoomMember;
  identity: TokenIdentity;
};

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function findMemberByHandle(room: ChatRoom, handle: string): RoomMember | undefined {
  return room.members.find((member) => member.handle === handle);
}

export function bindTokenToRoomMembership(input: {
  tokenSecret: string;
  roomId: string;
}): BindResult | null {
  const identity = verifyToken(input.tokenSecret, input.roomId);
  if (!identity) return null;
  if (!identity.handle || identity.handle.trim().length === 0) {
    throw new Error('token has no handle — admin must mint with --handle');
  }
  const room = findChatRoomById(input.roomId);
  if (!room) return null;
  const normalisedHandle = normaliseHandle(identity.handle);
  const existing = findMemberByHandle(room, normalisedHandle);
  if (existing) {
    // Side-rooms fanout bug fix (2026-05-20): even when the chat_room_members
    // row already exists, the room_memberships row (which fanout actually
    // reads to find the live PTY) may be missing or bound to a stale
    // browser-session synthetic terminal. Re-bind so subsequent messages
    // route to the live terminal record's pane.
    bindRoomHandleToLiveTerminal(input.roomId, normalisedHandle);
    return { room, member: existing, identity };
  }
  const updatedRoom = inviteAgentToRoom({
    roomId: input.roomId,
    agentHandle: normalisedHandle
  });
  // Side-rooms fanout bug fix (2026-05-20): inviteAgentToRoom only writes
  // chat_room_members. Without the matching room_memberships row,
  // fanoutMessageToRoomTerminals silently skips this member because the
  // membership lookup returns no terminal_id. Bind the live terminal here
  // so message delivery works from the first message onward.
  bindRoomHandleToLiveTerminal(input.roomId, normalisedHandle);
  const justJoined = findMemberByHandle(updatedRoom, normalisedHandle);
  if (!justJoined) {
    throw new Error('inviteAgentToRoom did not surface the new member');
  }
  return { room: updatedRoom, member: justJoined, identity };
}

export function resolveMembershipForToken(
  tokenSecret: string,
  roomId: string
): RoomMember | null {
  const identity = verifyToken(tokenSecret, roomId);
  if (!identity || !identity.handle) return null;
  const room = findChatRoomById(roomId);
  if (!room) return null;
  return findMemberByHandle(room, normaliseHandle(identity.handle)) ?? null;
}
