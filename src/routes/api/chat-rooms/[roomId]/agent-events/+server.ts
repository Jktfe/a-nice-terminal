/**
 * Agent timeline endpoint for one chat room.
 *
 * POST /api/chat-rooms/:roomId/agent-events
 *   { authorHandle, kind, summary, authorDisplayName?, details? }
 *   → records one agent event. Returns 201 with the new event.
 *
 * GET /api/chat-rooms/:roomId/agent-events
 *   → returns every agent event in the room, oldest first.
 *
 * Backs M16 agent-timeline slice 1 (backend). Slot into the room page
 * comes after @claude2 slice 5 closes.
 *
 * Mirrors the fail-closed validation pattern from M12 breaks + M19 typing:
 * assertRoomExists before any store call, parseRequiredJsonBody for the
 * POST body, explicit 400 on malformed/non-object/JSON-array bodies.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listAgentEventsInRoom,
  recordAgentEvent,
  type AgentEventKind
} from '$lib/server/agentTimelineStore';
import { doesChatRoomExist, findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

const allowedKinds = new Set<AgentEventKind>([
  'tool-call',
  'status-transition',
  'plan-mode-entered',
  'plan-mode-exited',
  'ask-user-question'
]);

export const GET: RequestHandler = async ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  return json({ agentEvents: listAgentEventsInRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate agent-events POST.
  // Without this any unauthenticated caller could forge agent-timeline events.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const authorHandle = bodyAsObject.authorHandle;
  if (typeof authorHandle !== 'string' || authorHandle.trim().length === 0) {
    throw error(400, 'authorHandle must be a non-empty string.');
  }

  const handleWithAtSign = authorHandle.startsWith('@')
    ? authorHandle
    : `@${authorHandle}`;
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const summary = bodyAsObject.summary;
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw error(400, 'summary must be a non-empty string.');
  }

  const kindRaw = bodyAsObject.kind;
  if (typeof kindRaw !== 'string' || !allowedKinds.has(kindRaw as AgentEventKind)) {
    throw error(400, `kind must be one of: ${Array.from(allowedKinds).join(', ')}.`);
  }

  const authorDisplayNameRaw = bodyAsObject.authorDisplayName;
  const authorDisplayName =
    typeof authorDisplayNameRaw === 'string' ? authorDisplayNameRaw : undefined;

  const detailsRaw = bodyAsObject.details;
  let details: Record<string, unknown> | undefined;
  if (detailsRaw === undefined) {
    details = undefined;
  } else if (isPlainObject(detailsRaw)) {
    details = detailsRaw;
  } else {
    throw error(400, 'details must be a JSON object when provided.');
  }

  try {
    const newEvent = recordAgentEvent({
      roomId: params.roomId,
      authorHandle: handleWithAtSign,
      authorDisplayName,
      kind: kindRaw as AgentEventKind,
      summary,
      details
    });
    return json({ agentEvent: newEvent }, { status: 201 });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not record event.';
    throw error(400, reason);
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object with authorHandle, kind, summary.');
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
