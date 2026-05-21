/**
 * GET    /api/chat-rooms/:roomId/artefacts                 list non-deleted
 * POST   /api/chat-rooms/:roomId/artefacts                 create one
 * DELETE /api/chat-rooms/:roomId/artefacts?artefactId=     soft-delete
 *
 * Backs Task #91/#98 artefacts panel (HTML/decks/spreadsheets/docs/
 * mockups/other) for a room. Public-read membership-style; LAUNCH-BLOCKER
 * CVE FIX C (Finding #3, 2026-05-20) identity-gated write paths — the
 * comment "v1 unauthenticated" no longer reflects reality.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  createArtefactInRoom,
  isKnownArtefactKind,
  listArtefactsInRoom,
  softDeleteArtefact
} from '$lib/server/chatRoomArtefactStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = ({ params }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  return json({ artefacts: listArtefactsInRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as
    | {
        kind?: unknown;
        title?: unknown;
        refUrl?: unknown;
        summary?: unknown;
        createdBy?: unknown;
      }
    | null;
  if (!payload) throw error(400, 'JSON body required.');

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): identity-gate the
  // artefact-create. The resolved handle becomes createdBy when the caller
  // didn't supply one, so unauthenticated callers can no longer mint
  // artefacts attributed to anyone.
  const auth = requireChatRoomMutationAuth(params.roomId, request, payload);

  if (!isKnownArtefactKind(payload.kind)) {
    throw error(400, `kind must be one of html|deck|spreadsheet|doc|mockup|other.`);
  }
  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    throw error(400, 'title is required.');
  }
  const artefact = createArtefactInRoom({
    roomId: params.roomId,
    kind: payload.kind,
    title: payload.title,
    refUrl: typeof payload.refUrl === 'string' ? payload.refUrl : null,
    summary: typeof payload.summary === 'string' ? payload.summary : null,
    createdBy: typeof payload.createdBy === 'string' ? payload.createdBy : auth.handle
  });
  return json(artefact, { status: 201 });
};

export const DELETE: RequestHandler = ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  requireChatRoomMutationAuth(params.roomId, request, null);
  const artefactId = url.searchParams.get('artefactId');
  if (!artefactId) throw error(400, 'artefactId query parameter required.');
  const removed = softDeleteArtefact(artefactId);
  if (!removed) throw error(404, 'Artefact not found.');
  return new Response(null, { status: 204 });
};
