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
    return { room, member: existing, identity };
  }
  const updatedRoom = inviteAgentToRoom({
    roomId: input.roomId,
    agentHandle: normalisedHandle
  });
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
