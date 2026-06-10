/**
 * POST /api/chat-rooms/:roomId/screenshots/:sha/prune - soft-delete a
 * single screenshot index row in a room (file bytes survive on disk
 * per JWPK Q-E SOFT-DELETE + MANUAL PRUNE).
 *
 * M-SHARED-SCREENSHOTS T3b: writes are pidChain-strict via
 * resolveCallerIdentityStrict (M3.6a-v1 IDENTITY-GATE precedent).
 * Idempotent - already-soft-deleted rows return changed=false.
 *   - 404 unknown room or unknown (sha, room) pair
 *   - 403 missing/invalid pidChain identity
 *   - 400 malformed body
 *   - 200 + { sha, changed }
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { softDeleteScreenshot } from '$lib/server/screenshotIndexStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import { getIdentityDb } from '$lib/server/db';

function doesScreenshotExist(sha: string, roomId: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT 1 AS present FROM screenshots WHERE sha = ? AND room_id = ?`)
    .get(sha, roomId) as { present: number } | undefined;
  return row !== undefined;
}

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  if (!doesScreenshotExist(params.sha, params.roomId)) {
    throw error(404, 'Screenshot not found in this room.');
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with pidChain.');
  }

  resolveCallerIdentityStrict(params.roomId, request, rawBody);

  const changed = softDeleteScreenshot(params.sha, params.roomId);
  return json({ sha: params.sha, changed });
};
