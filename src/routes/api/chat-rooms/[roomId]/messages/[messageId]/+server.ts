/**
 * /api/chat-rooms/[roomId]/messages/[messageId]
 *
 * DELETE — #74 soft-delete a message authored by the caller.
 *   • 204 on success (deletedAtMs set, deletedByHandle stamped)
 *   • 403 if caller is not the original author
 *   • 404 if the message doesn't exist in this room
 * PATCH  — #76 edit-own-last-message body. Body { body: '…' }.
 *   • 200 with the updated message on success (editedAtMs set)
 *   • 400 on empty body
 *   • 403 if caller is not the original author
 *   • 404 if the message doesn't exist or is already deleted
 *
 * Both verbs broadcast a `message_updated` SSE event so live readers
 * see the tombstone / edit indicator without a refresh.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import {
  editMessageBody,
  getMessageById,
  softDeleteMessage
} from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { isOperatorHandle } from '$lib/server/operatorHandle';

function resolveCallerHandle(roomId: string, request: Request, rawBody: unknown): string | null {
  // Try cookie/Bearer first (iterates every ant_browser_session cookie
  // per the multi-cookie fix in 2dd31af — fixes the antv4 'can't delete'
  // case where a Path=/ demo-login cookie masked the per-room one).
  // Fall back to pidChain for the CLI path.
  const cookieHandle = resolveCallerHandleAnyRoom(request);
  if (cookieHandle) return cookieHandle;
  const pidChain = parsePidChainFromBody(rawBody);
  return resolveServerSideHandle(roomId, pidChain) ?? null;
}

function assertMessageInRoom(messageId: string, roomId: string) {
  const existing = getMessageById(messageId);
  if (!existing) throw error(404, 'Message not found.');
  if (existing.roomId !== roomId) throw error(404, 'Message not found.');
  return existing;
}

function isSameAuthor(storedAuthorHandle: string, callerHandle: string): boolean {
  return storedAuthorHandle === callerHandle || (isOperatorHandle(storedAuthorHandle) && isOperatorHandle(callerHandle));
}

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const rawBody = await request.json().catch(() => null);
  const callerHandle = resolveCallerHandle(params.roomId, request, rawBody);
  if (!callerHandle) throw error(401, 'Identity required to delete a message.');

  const existing = assertMessageInRoom(params.messageId, params.roomId);
  // JWPK msg_3535ek7e5p: the operator may delete ANY post (to clear agent
  // chatter from search); everyone else only their own. Operator deletes
  // also purge the body (see softDeleteMessage).
  const callerIsOperator = isOperatorHandle(callerHandle);
  if (!callerIsOperator && !isSameAuthor(existing.authorHandle, callerHandle)) {
    throw error(403, 'Only the author or the operator can delete this message.');
  }
  if (existing.deletedAtMs) {
    throw error(409, 'Message is already deleted.');
  }
  // JWPK msg_uot85o75mh: the operator may clear system clutter (join notices,
  // idle nudges, context breaks) from the room/search; everyone else is still
  // blocked from deleting system-authored posts via the message menu.
  if (!callerIsOperator && (existing.kind === 'system' || existing.kind === 'system-break')) {
    throw error(409, 'System messages cannot be deleted from the message menu.');
  }

  const updated = softDeleteMessage({
    messageId: params.messageId,
    byHandle: callerHandle,
    asOperator: callerIsOperator
  });
  if (!updated) {
    throw error(409, 'Message changed before delete completed. Refresh and try again.');
  }
  broadcastToRoom(params.roomId, { type: 'message_updated', message: updated });
  return new Response(null, { status: 204 });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'JSON body required.');
  const payload = rawBody as { body?: unknown };
  if (typeof payload.body !== 'string' || payload.body.trim().length === 0) {
    throw error(400, 'body is required (non-empty string).');
  }
  const callerHandle = resolveCallerHandle(params.roomId, request, rawBody);
  if (!callerHandle) throw error(401, 'Identity required to edit a message.');

  const existing = assertMessageInRoom(params.messageId, params.roomId);
  if (!isSameAuthor(existing.authorHandle, callerHandle)) {
    throw error(403, 'Only the author can edit this message.');
  }
  if (existing.deletedAtMs) {
    throw error(409, 'Cannot edit a deleted message.');
  }

  const updated = editMessageBody({
    messageId: params.messageId,
    byHandle: callerHandle,
    newBody: payload.body
  });
  if (!updated) throw error(500, 'Edit failed.');
  broadcastToRoom(params.roomId, { type: 'message_updated', message: updated });
  return json({ message: updated });
};
