/**
 * GET    /api/chat-rooms/:roomId/file-refs                 list non-deleted
 * POST   /api/chat-rooms/:roomId/file-refs                 flag a file path
 * DELETE /api/chat-rooms/:roomId/file-refs?fileRefId=…     soft-delete
 *
 * Task #111 v3-parity. Read access is enforced centrally by hooks.server.ts
 * for room-scoped GET APIs before this handler runs.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  createFileRefInRoom,
  listFileRefsInRoom,
  softDeleteFileRef
} from '$lib/server/chatRoomFileRefStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = ({ params }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  return json({ fileRefs: listFileRefsInRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as
    | { filePath?: unknown; note?: unknown; flaggedBy?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate file-refs POST.
  requireChatRoomMutationAuth(params.roomId, request, payload);
  if (typeof payload.filePath !== 'string' || payload.filePath.trim().length === 0) {
    throw error(400, 'filePath is required.');
  }
  const fileRef = createFileRefInRoom({
    roomId: params.roomId,
    filePath: payload.filePath,
    note: typeof payload.note === 'string' ? payload.note : null,
    flaggedBy: typeof payload.flaggedBy === 'string' ? payload.flaggedBy : null
  });
  return json(fileRef, { status: 201 });
};

export const DELETE: RequestHandler = ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate file-refs DELETE.
  requireChatRoomMutationAuth(params.roomId, request, null);
  const fileRefId = url.searchParams.get('fileRefId');
  if (!fileRefId) throw error(400, 'fileRefId query parameter required.');
  const removed = softDeleteFileRef(fileRefId);
  if (!removed) throw error(404, 'File ref not found.');
  return new Response(null, { status: 204 });
};
