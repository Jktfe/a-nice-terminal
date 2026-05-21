/**
 * Add, remove, or list emoji reactions on a chat message.
 *
 *   POST /api/chat-rooms/:roomId/messages/:messageId/reactions
 *     Body: { reactorHandle, emoji }
 *     → 201 { reaction }   the stored reaction (idempotent per triple)
 *     → 400                missing/blank fields, malformed JSON, emoji too long
 *     → 404                unknown room, message not in this room,
 *                          reactor is not a member of the room
 *
 *   DELETE /api/chat-rooms/:roomId/messages/:messageId/reactions
 *     Body: { reactorHandle, emoji }
 *     → 200 { wasReactionThere }
 *     → 400                missing/blank fields, malformed JSON
 *     → 404                unknown room, message not in this room,
 *                          reactor is not a member of the room
 *
 *   GET /api/chat-rooms/:roomId/messages/:messageId/reactions
 *     → 200 { reactions: MessageReaction[] }   add-order
 *     → 404                                    unknown room or wrong-room message
 *
 * Backs M17 reactions slice 1 backend.
 *
 * Security: membership-before-validation matches M16 + M11 + M19 + M24 —
 * load room, confirm message belongs to it, normalise + check member,
 * then validate other body fields.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listMessagesInRoom, type ChatMessage } from '$lib/server/chatMessageStore';
import {
  addReactionToMessage,
  listReactionsForMessage,
  removeReactionFromMessage
} from '$lib/server/messageReactionStore';
import { collectAskCandidateFromReaction } from '$lib/server/askCandidateStore';
import { fanoutReactionToAuthor } from '$lib/server/pty-inject-fanout';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = ({ params }) => {
  const { room, message } = locateRoomAndMessage(
    params.roomId,
    params.messageId
  );
  if (!room) throw error(404, 'Room not found.');
  if (!message) throw error(404, 'Message not found in this room.');
  return json({ reactions: listReactionsForMessage(params.messageId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const { handleWithAtSign, emoji, message } = await readAndAuthoriseReactionBody(
    params.roomId,
    params.messageId,
    request
  );
  try {
    const reaction = addReactionToMessage({
      messageId: params.messageId,
      reactorHandle: handleWithAtSign,
      emoji
    });
    try {
      collectAskCandidateFromReaction({
        roomId: params.roomId,
        message,
        reactorHandle: handleWithAtSign,
        emoji
      });
    } catch {
      /* candidate inference is best-effort; reaction still succeeds */
    }
    // JWPK msg_83dhe5anh7 (2026-05-19): notify the original author's terminal
    // that someone reacted. Best-effort — POST already succeeded; PTY fanout
    // is decorative.
    try {
      fanoutReactionToAuthor(params.roomId, params.messageId, handleWithAtSign, emoji);
    } catch {
      /* fanout is best-effort */
    }
    return json({ reaction }, { status: 201 });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not add reaction.';
    throw error(400, failureMessage);
  }
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const { handleWithAtSign, emoji } = await readAndAuthoriseReactionBody(
    params.roomId,
    params.messageId,
    request
  );
  const wasReactionThere = removeReactionFromMessage({
    messageId: params.messageId,
    reactorHandle: handleWithAtSign,
    emoji
  });
  return json({ wasReactionThere });
};

async function readAndAuthoriseReactionBody(
  roomId: string,
  messageId: string,
  request: Request
): Promise<{ handleWithAtSign: string; emoji: string; message: ChatMessage }> {
  const { room, message } = locateRoomAndMessage(roomId, messageId);
  if (!room) throw error(404, 'Room not found.');
  if (!message) throw error(404, 'Message not found in this room.');

  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate reactions POST/DELETE.
  // Both verbs flow through this helper so a single gate covers both.
  const auth = requireChatRoomMutationAuth(roomId, request, bodyAsObject);

  const reactorHandleRaw = bodyAsObject.reactorHandle;
  if (typeof reactorHandleRaw !== 'string' || reactorHandleRaw.trim().length === 0) {
    throw error(400, 'reactorHandle must be a non-empty string.');
  }
  const trimmedHandle = reactorHandleRaw.trim();
  const handleWithAtSign = trimmedHandle.startsWith('@')
    ? trimmedHandle
    : `@${trimmedHandle}`;
  // Auth-vs-target anti-spoof (msg_hodqchn3ek code-review HIGH #3,
  // 2026-05-20): caller must be reacting/un-reacting as themselves,
  // not as another room participant. Admin-bearer bypass for tooling.
  if (!auth.isAdminBearer && auth.handle !== handleWithAtSign) {
    throw error(403, `caller ${auth.handle} cannot react as ${handleWithAtSign}`);
  }
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const emojiRaw = bodyAsObject.emoji;
  if (typeof emojiRaw !== 'string' || emojiRaw.trim().length === 0) {
    throw error(400, 'emoji must be a non-empty string.');
  }
  return { handleWithAtSign, emoji: emojiRaw, message };
}

function locateRoomAndMessage(roomId: string, messageId: string) {
  const room = findChatRoomById(roomId);
  if (!room) return { room: undefined, message: undefined };
  const message = listMessagesInRoom(roomId).find(
    (message) => message.id === messageId
  );
  return { room, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
