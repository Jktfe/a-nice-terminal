/**
 * GET    /api/chat-rooms/:roomId/artefacts                 list non-deleted
 * POST   /api/chat-rooms/:roomId/artefacts                 create one
 * DELETE /api/chat-rooms/:roomId/artefacts?artefactId=     soft-delete
 *
 * Backs Task #91/#98 artefacts panel (HTML/decks/spreadsheets/docs/
 * mockups/other) for a room. Read access is enforced centrally by
 * hooks.server.ts for room-scoped GET APIs; LAUNCH-BLOCKER CVE FIX C
 * (Finding #3, 2026-05-20) identity-gated write paths — the comment
 * "v1 unauthenticated" no longer reflects reality.
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
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');
  // rv1 data-scoping fix: the artefacts list had NO read gate — any caller
  // could read any room's artefacts. Gate it like every other room-scoped
  // read (membership / admin-bearer containment). 404 for non-members so the
  // room id space isn't probeable; the write paths below already gate.
  await requireChatRoomReadAccess(request, room);
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
    throw error(400, `kind must be one of html|deck|stage|spreadsheet|doc|mockup|tracker|other.`);
  }
  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    throw error(400, 'title is required.');
  }

  // Auth-vs-target anti-spoof — mirrors docs/decks (GAP-4a/4b, 2026-05-20).
  // The gate above stops anonymous mints, but an authenticated room member
  // could still attribute the artefact to someone else's handle. A supplied
  // createdBy must match the resolved caller; admin-bearer bypasses (CI/
  // automation). Omitted createdBy falls back to the resolved caller.
  const requestedCreatedBy = typeof payload.createdBy === 'string' ? payload.createdBy : undefined;
  if (requestedCreatedBy !== undefined && !auth.isAdminBearer && auth.handle !== requestedCreatedBy) {
    throw error(403, `caller ${auth.handle} cannot create artefact as ${requestedCreatedBy}`);
  }
  const createdBy = requestedCreatedBy ?? auth.handle;

  const artefact = createArtefactInRoom({
    roomId: params.roomId,
    kind: payload.kind,
    title: payload.title,
    refUrl: typeof payload.refUrl === 'string' ? payload.refUrl : null,
    summary: typeof payload.summary === 'string' ? payload.summary : null,
    createdBy
  });
  return json(artefact, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as unknown;
  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  requireChatRoomMutationAuth(params.roomId, request, payload);
  const artefactId = url.searchParams.get('artefactId');
  if (!artefactId) throw error(400, 'artefactId query parameter required.');
  const removed = softDeleteArtefact(artefactId);
  if (!removed) throw error(404, 'Artefact not found.');
  return new Response(null, { status: 204 });
};
