/**
 * Legacy antchat v1.1.1 compatibility endpoint.
 *
 * The installed CLI exchanges `ant://host/r/<room>?invite=<invite>` via:
 * POST /api/sessions/:roomId/invites/:inviteId/exchange
 * body: { password, kind, handle? }
 *
 * v4's canonical path is /api/chat-invites/:inviteId/exchange. Keep this
 * bridge until the native app bundles a v4 CLI everywhere.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  legacyExchangeResponse,
  optionalString,
  parseJsonObject,
  parseKind,
  requireBodyString
} from '$lib/server/legacyAntchatCompat';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';

export const POST: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  const inviteId = params.inviteId ?? '';
  if (roomId.length === 0) throw error(400, 'URL roomId is required.');
  if (inviteId.length === 0) throw error(400, 'URL inviteId is required.');
  if (!doesChatRoomExist(roomId)) throw error(404, 'Room not found.');

  const body = await parseJsonObject(request);
  return legacyExchangeResponse({
    roomId,
    inviteId,
    password: requireBodyString(body, ['password']),
    kind: parseKind(body.kind),
    handle: optionalString(body, ['handle'])
  });
};
