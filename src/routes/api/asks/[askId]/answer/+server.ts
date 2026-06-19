/**
 * Move one ask from open to answered.
 *
 *   POST /api/asks/:askId/answer
 *     Body: { answeredByHandle, answer, answeredByDisplayName? }
 *     → 200 { ask }   the updated ask (status=answered)
 *     → 400           missing/blank fields, malformed JSON, already-resolved
 *     → 404           unknown askId, the ask's room no longer exists,
 *                     or answeredByHandle is not a member of that room
 *
 * Backs asks slice 2 backend. Membership-before-validation matches the
 * rest of the platform: locate the ask, confirm its room still exists,
 * normalise the actor handle, reject non-members, THEN validate the
 * answer field. No-mutate-after-failure: every failure path returns
 * before answerAsk() is invoked, so findAskById reports the same state.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { canonicalOperatorHandleForMembers } from '$lib/operatorSentinel';
import { answerAsk, findAskById, hasResponseRequiredAsksForHandle, type Ask } from '$lib/server/askStore';
import { inboxRoomIdFor } from '$lib/server/humanInboxRoomStore';
import { consumeConsentGrant } from '$lib/server/consentGrantStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const POST: RequestHandler = async ({ params, request }) => {
  const ask = findAskById(params.askId);
  if (!ask) {
    throw error(404, 'Ask not found.');
  }
  const room = findChatRoomById(ask.roomId);
  if (!room) {
    throw error(404, 'The room for this ask no longer exists.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);
  requireChatRoomMutationAuth(ask.roomId, request, bodyAsObject);

  const answeredByHandleRaw = bodyAsObject.answeredByHandle;
  if (typeof answeredByHandleRaw !== 'string' || answeredByHandleRaw.trim().length === 0) {
    throw error(400, 'answeredByHandle must be a non-empty string.');
  }
  const trimmedHandle = answeredByHandleRaw.trim();
  const handleWithAtSign = canonicalOperatorHandleForMembers(
    trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`,
    room.members
  );
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const answerRaw = bodyAsObject.answer;
  if (typeof answerRaw !== 'string' || answerRaw.trim().length === 0) {
    throw error(400, 'answer must be a non-empty string.');
  }
  const consentTopicRaw = bodyAsObject.consentTopic ?? bodyAsObject.consent_topic;
  let consentResult: ReturnType<typeof consumeConsentGrant> | null = null;
  if (consentTopicRaw !== undefined && consentTopicRaw !== null) {
    if (typeof consentTopicRaw !== 'string' || consentTopicRaw.trim().length === 0) {
      throw error(400, 'consentTopic must be a non-empty string when present.');
    }
    const consentSourceRaw = bodyAsObject.consentSource ?? bodyAsObject.consent_source;
    if (
      consentSourceRaw !== undefined &&
      consentSourceRaw !== null &&
      typeof consentSourceRaw !== 'string'
    ) {
      throw error(400, 'consentSource must be a string when present.');
    }
    consentResult = consumeConsentGrant({
      roomId: ask.roomId,
      grantedTo: handleWithAtSign,
      topic: consentTopicRaw.trim(),
      source: typeof consentSourceRaw === 'string' ? consentSourceRaw.trim() : null,
      actorHandle: handleWithAtSign
    });
    if (!consentResult.allowed) {
      throw error(403, `Consent grant required: ${consentResult.reason}.`);
    }
  }
  const answeredByDisplayNameRaw = bodyAsObject.answeredByDisplayName;
  const answeredByDisplayName =
    typeof answeredByDisplayNameRaw === 'string' ? answeredByDisplayNameRaw : undefined;

  try {
    const updatedAsk = answerAsk({
      askId: ask.id,
      answeredByHandle: handleWithAtSign,
      answeredByDisplayName,
      answer: answerRaw
    });
    try {
      const roomMessage = postSystemMessage({
        roomId: ask.roomId,
        body: formatAnsweredAskRoomMessage(ask, updatedAsk)
      });
      try {
        fanoutMessageToRoomTerminals(ask.roomId, roomMessage, {
          allowSystemMessage: true,
          forceBroadcastToAll: true
        });
      } catch {
        /* terminal fanout is best-effort; the room message is already persisted */
      }
    } catch {
      /* The ask answer is authoritative; a receipt failure must not re-open it. */
    }
    // Asks-as-pill (slice 3): tell the room the askee's pill may have flipped.
    // Listeners re-derive `response-required` from the open-asks count for the
    // target handle. We only emit when the resolved ask actually had a target;
    // legacy NULL-target rows don't drive a pill.
    if (ask.targetHandle) {
      const askResolvedPayload = {
        type: 'ask_resolved' as const,
        askId: ask.id,
        targetHandle: ask.targetHandle,
        status: updatedAsk.status,
        stillResponseRequired: hasResponseRequiredAsksForHandle(ask.targetHandle)
      };
      try {
        broadcastToRoom(ask.roomId, askResolvedPayload);
      } catch {
        /* pill broadcast best-effort; UIs re-poll on focus anyway */
      }
      // Mirror into the askee's inbox room (per-human inbox JWPK 2026-05-22)
      // so the inbox UI auto-updates without polling. Separate try/catch so
      // an originating-room broadcast failure doesn't suppress the inbox
      // one (and vice-versa).
      try {
        broadcastToRoom(inboxRoomIdFor(ask.targetHandle), askResolvedPayload);
      } catch {
        /* inbox broadcast best-effort */
      }
    }
    return json({
      ask: updatedAsk,
      consent: consentResult?.allowed
        ? {
            grantId: consentResult.grant.id,
            status: consentResult.grant.status,
            answerCount: consentResult.grant.answerCount
          }
        : undefined
    });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not answer ask.';
    throw error(400, failureMessage);
  }
};

function formatAnsweredAskRoomMessage(originalAsk: Ask, answeredAsk: Ask): string {
  const answeredBy = answeredAsk.answeredByHandle ?? 'unknown';
  const answer = answeredAsk.answer ?? '';
  return `Open ask answered by ${answeredBy}: ${originalAsk.title}\n\n${answer}`;
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
