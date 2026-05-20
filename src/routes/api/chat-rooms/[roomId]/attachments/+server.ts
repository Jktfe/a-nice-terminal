/**
 * Files shared in one chat room.
 *
 * POST /api/chat-rooms/:roomId/attachments
 *   Body: { filename, mimeType, contentsBase64, uploadedByHandle }
 *   → 201 { sharedFile }    metadata only (no contents echoed back)
 *   → 400                   missing/blank/oversize fields, malformed JSON
 *   → 404                   unknown room, or uploader is not a member
 *
 * GET /api/chat-rooms/:roomId/attachments
 *   → 200 { sharedFiles }   newest first, metadata only
 *   → 404                   unknown room
 *
 * Backs M11 upload-a-file slice 1 (backend). Files are stored in memory
 * by chatAttachmentStore. The download endpoint lives in
 * /attachments/[attachmentId]/+server.ts.
 *
 * Security: membership-before-validation matches M16 agent-events and
 * M19 typing — load the room, normalise the handle, reject non-members
 * with 404 before checking any other body field.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  shareFileInRoom,
  listFilesSharedInRoom,
  type SharedFile
} from '$lib/server/chatAttachmentStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

type FileMetadata = Omit<SharedFile, 'contentsBase64'>;

export const GET: RequestHandler = async ({ params }) => {
  if (!findChatRoomById(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const files = listFilesSharedInRoom(params.roomId);
  return json({ sharedFiles: files.map(stripContentsForList) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate attachments POST.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const uploaderHandleRaw = bodyAsObject.uploadedByHandle;
  if (typeof uploaderHandleRaw !== 'string' || uploaderHandleRaw.trim().length === 0) {
    throw error(400, 'uploadedByHandle must be a non-empty string.');
  }
  const trimmedHandle = uploaderHandleRaw.trim();
  const handleWithAtSign = trimmedHandle.startsWith('@')
    ? trimmedHandle
    : `@${trimmedHandle}`;
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const filename = bodyAsObject.filename;
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw error(400, 'filename must be a non-empty string.');
  }
  const mimeType = bodyAsObject.mimeType;
  if (typeof mimeType !== 'string' || mimeType.trim().length === 0) {
    throw error(400, 'mimeType must be a non-empty string.');
  }
  const contentsBase64 = bodyAsObject.contentsBase64;
  if (typeof contentsBase64 !== 'string' || contentsBase64.length === 0) {
    throw error(400, 'contentsBase64 must be a non-empty base64 string.');
  }

  try {
    const sharedFile = shareFileInRoom({
      roomId: params.roomId,
      filename,
      mimeType,
      contentsBase64,
      uploadedByHandle: handleWithAtSign
    });
    return json({ sharedFile: stripContentsForList(sharedFile) }, { status: 201 });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not share file.';
    throw error(400, reason);
  }
};

function stripContentsForList(file: SharedFile): FileMetadata {
  // The list/POST responses carry metadata only — bytes flow via the
  // dedicated download endpoint, keeping these JSON payloads small.
  const { contentsBase64: _unused, ...metadata } = file;
  return metadata;
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
