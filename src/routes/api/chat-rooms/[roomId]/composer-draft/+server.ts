/**
 * Composer draft persistence — per-room, per-author.
 *
 *   GET    /api/chat-rooms/:roomId/composer-draft?authorHandle=@x
 *     → 200 { draftText: string }   empty string when no draft is saved
 *     → 400                         authorHandle query param missing
 *     → 404                         unknown room
 *
 *   PUT    /api/chat-rooms/:roomId/composer-draft   body { authorHandle, draftText }
 *     → 200 { draft }               on success (idempotent replace)
 *     → 400                         missing/malformed body or blank draftText
 *     → 404                         unknown room
 *
 *   DELETE /api/chat-rooms/:roomId/composer-draft   body { authorHandle }
 *     → 200 { wasCleared: boolean }
 *     → 400                         missing/malformed body
 *     → 404                         unknown room
 *
 * Backs the "Draft persistence" capability ledger row. UI wiring lands in
 * a later slice that respects the ChatComposer freeze.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  saveDraft,
  findDraft,
  clearDraft
} from '$lib/server/composerDraftStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) {
    throw error(404, 'Room not found.');
  }
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}

export const GET: RequestHandler = ({ params, url }) => {
  assertRoomExists(params.roomId);
  const authorHandle = url.searchParams.get('authorHandle');
  if (!authorHandle || authorHandle.trim().length === 0) {
    throw error(400, 'authorHandle query parameter required.');
  }
  const draft = findDraft(params.roomId, authorHandle);
  return json({ draftText: draft?.draftText ?? '' });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate composer-draft PUT.
  const auth = requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const authorHandle = bodyAsObject.authorHandle;
  if (typeof authorHandle !== 'string' || authorHandle.trim().length === 0) {
    throw error(400, 'authorHandle must be a non-empty string.');
  }
  // Auth-vs-target anti-spoof (msg_hodqchn3ek #3, UX harness ddc44e8
  // GAP-3b): caller can only save THEIR OWN draft.
  if (!auth.isAdminBearer && auth.handle !== authorHandle) {
    throw error(403, `caller ${auth.handle} cannot save draft as ${authorHandle}`);
  }

  const draftText = bodyAsObject.draftText;
  if (typeof draftText !== 'string') {
    throw error(400, 'draftText must be a string.');
  }

  try {
    const draft = saveDraft({
      roomId: params.roomId,
      authorHandle,
      draftText
    });
    return json({ draft });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not save draft.';
    throw error(400, message);
  }
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate composer-draft DELETE.
  const auth = requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const authorHandle = bodyAsObject.authorHandle;
  if (typeof authorHandle !== 'string' || authorHandle.trim().length === 0) {
    throw error(400, 'authorHandle must be a non-empty string.');
  }
  // Auth-vs-target anti-spoof: caller can only clear THEIR OWN draft.
  if (!auth.isAdminBearer && auth.handle !== authorHandle) {
    throw error(403, `caller ${auth.handle} cannot clear draft for ${authorHandle}`);
  }

  const wasCleared = clearDraft({ roomId: params.roomId, authorHandle });
  return json({ wasCleared });
};
