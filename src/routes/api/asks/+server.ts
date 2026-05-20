/**
 * Asks — open + list, room-scoped or cross-room.
 *
 *   GET /api/asks[?roomId=...]
 *     → 200 { asks: Ask[] }   open asks only, open-order
 *     → 404                   unknown roomId when provided
 *
 *   POST /api/asks
 *     Body: { roomId, openedByHandle, title, body, openedByDisplayName? }
 *     → 201 { ask }   the new ask (status=open)
 *     → 400           missing/blank fields, malformed JSON
 *     → 404           unknown room, or openedByHandle is not a member
 *
 * Backs asks foundation slice 1 backend.
 *
 * Security: membership-before-validation matches the rest of the platform
 * (M16/M11/M19/M24/M17). Load the room, normalise the handle, reject
 * non-members with 404, THEN validate other body fields. No-create
 * guarantee: every failed POST path returns early before askStore.openAsk
 * is invoked, so a subsequent GET /api/asks shows zero state change.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  listAllRecentlyAnsweredAsks,
  listAllOpenAsks,
  listRecentlyAnsweredAsksInRoom,
  listOpenAsksInRoom,
  openAskInRoom
} from '$lib/server/askStore';
import {
  backfillAskCandidatesFromRecentMessages,
  listOpenAskCandidates
} from '$lib/server/askCandidateStore';

export const GET: RequestHandler = ({ url }) => {
  try {
    backfillAskCandidatesFromRecentMessages();
  } catch {
    /* candidate backfill is best-effort; explicit asks remain authoritative */
  }
  const rawRoomId = url.searchParams.get('roomId');
  if (rawRoomId === null) {
    return json({
      asks: listAllOpenAsks(),
      recentlyAnswered: listAllRecentlyAnsweredAsks(),
      candidates: listOpenAskCandidates()
    });
  }
  const trimmedRoomId = rawRoomId.trim();
  if (trimmedRoomId.length === 0) {
    return json({
      asks: listAllOpenAsks(),
      recentlyAnswered: listAllRecentlyAnsweredAsks(),
      candidates: listOpenAskCandidates()
    });
  }
  if (!findChatRoomById(trimmedRoomId)) {
    throw error(404, 'Room not found.');
  }
  const openOnly = url.searchParams.get('openOnly') === '1';
  if (openOnly) {
    return json({ asks: listOpenAsksInRoom(trimmedRoomId) });
  }
  return json({
    asks: listOpenAsksInRoom(trimmedRoomId),
    recentlyAnswered: listRecentlyAnsweredAsksInRoom(trimmedRoomId),
    candidates: listOpenAskCandidates(trimmedRoomId)
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const bodyAsObject = await parseRequiredJsonBody(request);

  const roomIdRaw = bodyAsObject.roomId;
  if (typeof roomIdRaw !== 'string' || roomIdRaw.trim().length === 0) {
    throw error(400, 'roomId must be a non-empty string.');
  }
  const room = findChatRoomById(roomIdRaw.trim());
  if (!room) {
    throw error(404, 'Room not found.');
  }

  const openedByHandleRaw = bodyAsObject.openedByHandle;
  if (typeof openedByHandleRaw !== 'string' || openedByHandleRaw.trim().length === 0) {
    throw error(400, 'openedByHandle must be a non-empty string.');
  }
  const trimmedHandle = openedByHandleRaw.trim();
  const handleWithAtSign = trimmedHandle.startsWith('@')
    ? trimmedHandle
    : `@${trimmedHandle}`;
  // Asks principle (JWPK msg_86qcfvbkur 2026-05-19, locked in
  // audits/2026-05-19-asks-principle-user-only.md): Open Asks are
  // user-facing decision points only. Agent-pattern handles cannot file
  // asks via this surface — they must use POST /api/tasks for internal
  // tracking. Legitimate aggregator paths ([@you] mentions + 🙋🙌
  // reactions) go through askCandidateStore, not this endpoint.
  if (isAgentHandle(handleWithAtSign)) {
    throw error(
      400,
      'Agent handles cannot open user-facing asks. Use POST /api/tasks for agent-internal tracking. (Asks principle, audits/2026-05-19-asks-principle-user-only.md.)'
    );
  }
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const titleRaw = bodyAsObject.title;
  if (typeof titleRaw !== 'string' || titleRaw.trim().length === 0) {
    throw error(400, 'title must be a non-empty string.');
  }
  const bodyTextRaw = bodyAsObject.body;
  if (typeof bodyTextRaw !== 'string' || bodyTextRaw.trim().length === 0) {
    throw error(400, 'body must be a non-empty string.');
  }
  const openedByDisplayNameRaw = bodyAsObject.openedByDisplayName;
  const openedByDisplayName =
    typeof openedByDisplayNameRaw === 'string' ? openedByDisplayNameRaw : undefined;

  try {
    const ask = openAskInRoom({
      roomId: room.id,
      openedByHandle: handleWithAtSign,
      openedByDisplayName,
      title: titleRaw,
      body: bodyTextRaw
    });
    return json({ ask }, { status: 201 });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not open ask.';
    throw error(400, failureMessage);
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Agent handles use the @evolveant* prefix (Claude, Codex, Svelte, UX,
 * and future fleet members). The asks-principle audit
 * (audits/2026-05-19-asks-principle-user-only.md) reserves user-facing
 * asks for human operators; agents must use POST /api/tasks for
 * internal tracking. Configurable via ANT_ASK_AGENT_PATTERN env if a
 * deployment wants a different convention.
 */
function isAgentHandle(handle: string): boolean {
  const pattern = process.env.ANT_ASK_AGENT_PATTERN ?? '^@evolveant';
  try {
    return new RegExp(pattern).test(handle);
  } catch {
    // Bad regex env → fall back to the default check, never silently allow.
    return /^@evolveant/.test(handle);
  }
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (!isPlainObject(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}
