/**
 * HTTP endpoints for chat rooms.
 *
 * GET  /api/chat-rooms          → list every chat room, newest first.
 * POST /api/chat-rooms          → create one chat room from { name } and return it.
 *
 * No authentication yet. M01 ships the screen and round-trip; identity wiring
 * lands when the cap-2 work on the agent registry settles.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createChatRoom, listChatRooms } from '$lib/server/chatRoomStore';
import { recordParticipation } from '$lib/server/chatRoomParticipationHistoryStore';
import { bindRoomHandleToLiveTerminal } from '$lib/server/terminalHandleBinding';

export const GET: RequestHandler = async () => {
  return json({ chatRooms: listChatRooms() });
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
