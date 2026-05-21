/**
 * HTTP endpoints for chat rooms.
 *
 * GET  /api/chat-rooms          → list readable chat rooms, newest first.
 * POST /api/chat-rooms          → create one chat room from { name } and return it.
 *
 * Read auth is fail-closed and server-filtered by room membership.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createChatRoom, listChatRooms } from '$lib/server/chatRoomStore';
import { recordParticipation } from '$lib/server/chatRoomParticipationHistoryStore';
import { bindRoomHandleToLiveTerminal } from '$lib/server/terminalHandleBinding';
import { resolveChatRoomReadAccess, canReadChatRoom } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ request }) => {
  // Auth FIRST, then load. The previous shape `listReadableChatRooms(request, listChatRooms())`
  // evaluated listChatRooms() (1 SQL + N member-loads) as an argument BEFORE the auth check
  // ran — turning every unauthenticated 401 into a 1.5-8s response on a busy DB. Now the
  // no-auth fast-path returns in ~10ms; the authed path is unchanged in behaviour.
  const access = await resolveChatRoomReadAccess(request);
  if (!access) throw error(401, 'Authentication required.');
  const rooms = listChatRooms();
  const readable = access.isAdminBearer ? rooms : rooms.filter((room) => canReadChatRoom(room, access));
  return json({ chatRooms: readable });
};

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with at least a name field.');
  }

  const nameFromBody = (rawBody as { name?: unknown }).name;
  if (typeof nameFromBody !== 'string') {
    throw error(400, 'The name field must be a string.');
  }
  // #144: reject CLI flag leakage in room names
  const trimmedName = nameFromBody.trim();
  if (trimmedName.startsWith('--') || trimmedName.includes('--name')) {
    throw error(400, 'Room name cannot contain CLI flags like --name.');
  }

  const whoCreatedItFromBody = (rawBody as { whoCreatedIt?: unknown }).whoCreatedIt;
  const whoCreatedItCandidate =
    typeof whoCreatedItFromBody === 'string' ? whoCreatedItFromBody.trim() : '';
  // Task #138: CLI placeholder @cli or missing value resolves to canonical @you
  const whoCreatedIt =
    whoCreatedItCandidate.length > 0 && whoCreatedItCandidate !== '@cli'
      ? whoCreatedItCandidate
      : '@you';

  try {
    const newRoom = createChatRoom({ name: nameFromBody, whoCreatedIt });
    recordParticipation({ globalHandle: whoCreatedIt, roomId: newRoom.id });
    bindRoomHandleToLiveTerminal(newRoom.id, whoCreatedIt);
    return json({ chatRoom: newRoom }, { status: 201 });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not create room.';
    throw error(400, message);
  }
};
