/**
 * GET    /api/chat-rooms/:roomId/docs          list non-deleted docs
 * POST   /api/chat-rooms/:roomId/docs          create one doc
 * PATCH  /api/chat-rooms/:roomId/docs?docId=   update doc title/content
 * DELETE /api/chat-rooms/:roomId/docs?docId=   soft-delete
 *
 * Backs Task #124 docs subsystem: room-scoped markdown docs with
 * inline content storage (not just ref_url like artefacts).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  createDoc,
  listDocsInRoom,
  getDoc,
  updateDoc,
  softDeleteDoc
} from '$lib/server/docsStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = ({ params }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  return json({ docs: listDocsInRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as
    | { title?: unknown; content?: unknown; createdBy?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate docs POST.
  const auth = requireChatRoomMutationAuth(params.roomId, request, payload);

  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    throw error(400, 'title is required.');
  }

  // Auth-vs-target anti-spoof (UX harness ddc44e8 GAP-4b, 2026-05-20):
  // caller cannot stamp a doc with someone else's createdBy. If a body
  // value is supplied it must match the resolved caller; admin-bearer
  // bypass for operator/CI tooling. When no createdBy is supplied we
  // fall back to the resolved caller (server-trusted, not null).
  const requestedCreatedBy = typeof payload.createdBy === 'string' ? payload.createdBy : undefined;
  if (requestedCreatedBy !== undefined && !auth.isAdminBearer && auth.handle !== requestedCreatedBy) {
    throw error(403, `caller ${auth.handle} cannot create doc as ${requestedCreatedBy}`);
  }
  const createdBy = requestedCreatedBy ?? auth.handle;

  const doc = createDoc({
    roomId: params.roomId,
    title: payload.title,
    content: typeof payload.content === 'string' ? payload.content : undefined,
    createdBy
  });
  return json(doc, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  const docId = url.searchParams.get('docId');
  if (!docId) throw error(400, 'docId query parameter required.');

  const payload = (await request.json().catch(() => null)) as
    | { title?: unknown; content?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate docs PATCH.
  requireChatRoomMutationAuth(params.roomId, request, payload);

  const existing = getDoc(docId);
  if (!existing) throw error(404, 'Doc not found.');
  if (existing.roomId !== params.roomId) {
    throw error(403, 'Doc does not belong to this room.');
  }

  const updated = updateDoc(docId, {
    title: typeof payload.title === 'string' ? payload.title : undefined,
    content: typeof payload.content === 'string' ? payload.content : undefined
  });
  if (!updated) throw error(404, 'Doc not found.');
  return json(updated);
};

export const DELETE: RequestHandler = ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate docs DELETE.
  requireChatRoomMutationAuth(params.roomId, request, null);
  const docId = url.searchParams.get('docId');
  if (!docId) throw error(400, 'docId query parameter required.');

  const existing = getDoc(docId);
  if (!existing) throw error(404, 'Doc not found.');
  if (existing.roomId !== params.roomId) {
    throw error(403, 'Doc does not belong to this room.');
  }

  const removed = softDeleteDoc(docId);
  if (!removed) throw error(404, 'Doc not found.');
  return new Response(null, { status: 204 });
};
