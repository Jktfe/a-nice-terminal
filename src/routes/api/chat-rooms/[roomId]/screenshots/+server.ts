/**
 * GET  /api/chat-rooms/:roomId/screenshots - list active screenshots in a
 *   room, newest first. Soft-deleted rows are excluded.
 * POST /api/chat-rooms/:roomId/screenshots - receive a captured PNG, write
 *   to the per-room canonical path with dedup-before-write (T3c).
 *
 * GET (T3a Q6) matches the /messages GET precedent: room-exists only.
 * POST (T3c) is IDENTITY-GATE-strict via resolveCallerIdentityStrict
 * (M3.6a-v1). Body { bytes: base64 PNG, takenBy, topic?, dimensions?,
 *   parentSha?, deckSlug?, pidChain }.
 *   - 404 unknown room
 *   - 403 missing/invalid pidChain identity (POST)
 *   - 400 missing/invalid body fields or empty bytes (POST)
 *   - 409 SharedFolderDisabledError (POST, room flag OFF)
 *   - 200 + { kind, sha, canonicalPath, row } (POST)
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import {
  listScreenshotsForRoom,
  SharedFolderDisabledError
} from '$lib/server/screenshotIndexStore';
import { captureScreenshotToRoom } from '$lib/server/screenshotCapture';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';

export const GET: RequestHandler = async ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  return json({ screenshots: listScreenshotsForRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with bytes (base64), takenBy, pidChain.');
  }

  resolveCallerIdentityStrict(params.roomId, request, rawBody);

  const body = rawBody as Record<string, unknown>;
  const bytesB64 = body.bytes;
  const takenBy = body.takenBy;
  if (typeof bytesB64 !== 'string' || bytesB64.length === 0) {
    throw error(400, 'bytes (non-empty base64 string) is required.');
  }
  if (typeof takenBy !== 'string' || takenBy.length === 0) {
    throw error(400, 'takenBy (string) is required.');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(bytesB64, 'base64');
  } catch {
    throw error(400, 'bytes must be valid base64.');
  }
  if (buffer.length === 0) {
    throw error(400, 'bytes decodes to empty buffer.');
  }

  try {
    const result = await captureScreenshotToRoom({
      roomId: params.roomId,
      takenBy,
      bytes: buffer,
      topic: typeof body.topic === 'string' ? body.topic : undefined,
      dimensions: typeof body.dimensions === 'string' ? body.dimensions : undefined,
      parentSha: typeof body.parentSha === 'string' ? body.parentSha : undefined,
      deckSlug: typeof body.deckSlug === 'string' ? body.deckSlug : undefined
    });
    return json(result);
  } catch (cause) {
    if (cause instanceof SharedFolderDisabledError) {
      throw error(409, cause.message);
    }
    throw cause;
  }
};
