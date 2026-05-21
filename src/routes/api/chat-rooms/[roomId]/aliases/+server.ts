/**
 * Per-room alias endpoint.
 *
 *   GET    /api/chat-rooms/:roomId/aliases
 *     → 200 { aliases: RoomAliasEntry[] }   for a known room
 *     → 404                                  when the room does not exist
 *
 *   POST   /api/chat-rooms/:roomId/aliases   body { globalHandle, newAlias }
 *     → 201 { aliasEntry }                   on success
 *     → 409 { alias, collidesWith }          when the alias is already taken
 *     → 400 { message }                      on a missing/malformed body
 *     → 404                                  when the room does not exist
 *
 *   DELETE /api/chat-rooms/:roomId/aliases?globalHandle=@x
 *     → 204                                  alias removed (idempotent when no alias was set)
 *     → 400                                  globalHandle query param missing
 *     → 404                                  unknown room, or globalHandle is not a member
 *
 * Backs M03 participants panel · change-handle state (wireframe WTHef h03)
 * and edge case fe31 (collision suggestion).
 *
 * A room-scoped alias is a small but persistent change to how a member is
 * shown to other members, so the endpoint never accepts malformed input or
 * a missing room. Same fail-closed pattern as the breaks endpoint.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  setRoomAlias,
  removeRoomAlias,
  listAliasesForRoom,
  RoomAliasCollisionError
} from '$lib/server/chatRoomAliasStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) {
    throw error(404, 'Room not found.');
  }
}

function assertMemberOfRoom(roomId: string, globalHandle: string): void {
  const room = findChatRoomById(roomId);
  const isMember = room?.members.some((member) => member.handle === globalHandle) ?? false;
  if (!isMember) {
    throw error(404, `${globalHandle} is not a member of this room.`);
  }
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}

export const GET: RequestHandler = ({ params }) => {
  assertRoomExists(params.roomId);
  return json({ aliases: listAliasesForRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate aliases POST.
  const auth = requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const globalHandle = bodyAsObject.globalHandle;
  const newAlias = bodyAsObject.newAlias;

  if (typeof globalHandle !== 'string') {
    throw error(400, 'globalHandle must be a string.');
  }
  if (typeof newAlias !== 'string') {
    throw error(400, 'newAlias must be a string.');
  }
  // Auth-vs-target anti-spoof (msg_hodqchn3ek #3, UX harness ddc44e8
  // GAP-3c, 2026-05-20): caller can only alias THEIR OWN handle in
  // this room. Admin-bearer bypass for operator/CI tooling.
  if (!auth.isAdminBearer && auth.handle !== globalHandle) {
    throw error(403, `caller ${auth.handle} cannot set alias for ${globalHandle}`);
  }

  try {
    const aliasEntry = setRoomAlias({
      roomId: params.roomId,
      globalHandle,
      newAlias
    });
    return json({ aliasEntry }, { status: 201 });
  } catch (causeOfFailure) {
    if (causeOfFailure instanceof RoomAliasCollisionError) {
      return json(
        { alias: causeOfFailure.alias, collidesWith: causeOfFailure.collidesWith },
        { status: 409 }
      );
    }
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not set alias.';
    throw error(400, message);
  }
};

export const DELETE: RequestHandler = ({ params, url, request }) => {
  assertRoomExists(params.roomId);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate aliases DELETE.
  const auth = requireChatRoomMutationAuth(params.roomId, request, null);

  const globalHandle = url.searchParams.get('globalHandle');
  if (!globalHandle) {
    throw error(400, 'globalHandle query parameter required.');
  }
  // Auth-vs-target anti-spoof: caller can only remove THEIR OWN alias.
  if (!auth.isAdminBearer && auth.handle !== globalHandle) {
    throw error(403, `caller ${auth.handle} cannot remove alias for ${globalHandle}`);
  }

  assertMemberOfRoom(params.roomId, globalHandle);

  removeRoomAlias({ roomId: params.roomId, globalHandle });
  return new Response(null, { status: 204 });
};
