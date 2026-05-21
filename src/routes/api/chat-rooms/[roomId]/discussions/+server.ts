/**
 * src/routes/api/chat-rooms/[roomId]/discussions/+server.ts (M3.4b)
 *
 * GET  → list discussions for the room (status filter via ?status=open|closed|all)
 * POST → create a new discussion seeded from a parent message
 *
 * All writes go through IDENTITY-GATE (strict 403 via parsePidChainFromBody +
 * resolveServerSideHandle from $lib/server/identityGate, the same helpers
 * already in use by M3.b.4 mode route + M3.b.5 responders route + M3.7b
 * revoke route). GET is unauthenticated (read-only metadata).
 *
 * Wire JSON convention (per B1 lock): inner field names = snake_case
 * matching DB columns; top-level wrapper keys = camelCase (roomId,
 * pidChain, discussions).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';
import { getRoomMode } from '$lib/server/roomModesStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import {
  createDiscussion,
  getDiscussionByParent,
  listDiscussionsForRoom,
  type ListDiscussionsFilter
} from '$lib/server/chatDiscussionStore';

const VALID_STATUS_FILTERS = new Set<ListDiscussionsFilter>(['open', 'closed', 'all']);

export const GET: RequestHandler = async ({ params, url }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const statusRaw = url.searchParams.get('status') ?? 'open';
  if (!VALID_STATUS_FILTERS.has(statusRaw as ListDiscussionsFilter)) {
    throw error(400, 'status must be one of: open, closed, all.');
  }
  return json({
    roomId: params.roomId,
    discussions: listDiscussionsForRoom(params.roomId, statusRaw as ListDiscussionsFilter)
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  // M3.4b Q7 closed-room guard: discussion-create rejected when room is
  // closed. Discussion-CLOSE (PATCH) remains allowed in closed rooms so a
  // team can tidy outstanding threads before leaving the room frozen.
  if (getRoomMode(params.roomId) === 'closed') {
    throw error(409, "Room is closed (read-only). Reopen with 'ant room mode --room ID --set brainstorm|heads-down' before creating discussions.");
  }
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');

  const parentMessageId = (rawBody as { parentMessageId?: unknown }).parentMessageId;
  if (typeof parentMessageId !== 'string' || parentMessageId.length === 0) {
    throw error(400, 'parentMessageId (string) is required.');
  }
  const parentExists = listMessagesInRoom(params.roomId).some((m) => m.id === parentMessageId);
  if (!parentExists) throw error(404, 'Parent message not found in this room.');

  // M3.6a-v1 T2 PRE-BLOCK A: discussions is strict-only (no warning phase).
  // Discussions has no legacy clientAuthorHandle fallback to deprecate, so
  // missing identity always 403s with the Q3 hint body — even when the
  // deprecation window flag is in warning phase for /messages, /members.
  const handle = resolveCallerIdentityStrict(params.roomId, request, rawBody);

  const titleRaw = (rawBody as { title?: unknown }).title;
  const title = typeof titleRaw === 'string' && titleRaw.length > 0 ? titleRaw : null;

  const existing = getDiscussionByParent(params.roomId, parentMessageId);
  if (existing) return json({ discussion: existing }, { status: 409 });

  const discussion = createDiscussion({
    roomId: params.roomId,
    parentMessageId,
    title,
    opened_by: handle
  });
  return json({ discussion }, { status: 201 });
};
