/**
 * Download one file shared in a chat room.
 *
 * GET /api/chat-rooms/:roomId/attachments/:attachmentId
 *   → 200    body = raw bytes; content-type + content-disposition set
 *   → 404    unknown room, unknown attachment, or attachment lives in
 *            a different room (cross-room access prevention)
 *
 * The route body validates room/file ownership. Read authentication is enforced
 * in hooks.server.ts for GET /api/chat-rooms/:roomId/... before this handler.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { findSharedFileById } from '$lib/server/chatAttachmentStore';

export const GET: RequestHandler = ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const sharedFile = findSharedFileById(params.attachmentId);
  if (!sharedFile) {
    throw error(404, 'File not found.');
  }
  if (sharedFile.roomId !== params.roomId) {
    // Prevent reading a file from a different room by guessing its id.
    throw error(404, 'File not found.');
  }

  const bytes = decodeBase64ToArrayBuffer(sharedFile.contentsBase64);
  const safeFilename = encodeURIComponent(sharedFile.filename);
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': sharedFile.mimeType,
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename*=UTF-8''${safeFilename}`
    }
  });
};

function decodeBase64ToArrayBuffer(contentsBase64: string): ArrayBuffer {
  // Slice into a stand-alone ArrayBuffer so the body is not sharing memory
  // with Buffer's internal pool. Response wants BodyInit, and ArrayBuffer
  // satisfies that without the Uint8Array → BodyInit type friction.
  const nodeBuffer = Buffer.from(contentsBase64, 'base64');
  return nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength
  );
}
