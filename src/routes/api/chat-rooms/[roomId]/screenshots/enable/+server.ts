/**
 * PUT /api/chat-rooms/:roomId/screenshots/enable - toggle the per-room
 * shared screenshot folder opt-in flag.
 *
 * M-SHARED-SCREENSHOTS T3a Q-A + Q4: writes are pidChain-strict via
 * resolveCallerIdentityStrict (M3.6a-v1 IDENTITY-GATE precedent).
 *   - 404 unknown room
 *   - 403 missing/invalid pidChain identity
 *   - 400 missing/invalid enabled field
 *   - 200 + { enabled } on success
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { enableSharedFolder, isSharedFolderEnabled } from '$lib/server/screenshotIndexStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with enabled (boolean) + pidChain.');
  }

  resolveCallerIdentityStrict(params.roomId, request, rawBody);

  const enabledRaw = (rawBody as { enabled?: unknown }).enabled;
  if (typeof enabledRaw !== 'boolean') {
    throw error(400, 'enabled (boolean) is required.');
  }

  enableSharedFolder(params.roomId, enabledRaw);
  return json({ enabled: isSharedFolderEnabled(params.roomId) });
};
