/**
 * POST /api/chat-rooms/:roomId/join-with-token
 *
 * Body: { tokenSecret: string }
 * Success (200): { room, member, identity }
 *   - room: ChatRoom (already excludes invite-side hashes)
 *   - member: RoomMember (handle, displayName, joinedAt, kind)
 *   - identity: TokenIdentity (tokenId, inviteId, room_id, kind, handle)
 * Failure:
 *   400 — malformed body, missing tokenSecret, token has no handle invariant
 *   401 — generic "invite cannot be used" (covers bogus/revoked/wrong-room/no-room)
 *
 * tokenSecret is read from the request body and used only to call
 * bindTokenToRoomMembership. It is never echoed in the response or
 * surfaced in any error message.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bindTokenToRoomMembership } from '$lib/server/chatMembershipBinding';

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (failure) {
    if (failure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw failure;
  }
}

function requireString(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw error(400, `Field ${field} must be a non-empty string.`);
  }
  return value;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) {
    throw error(400, 'URL roomId is required.');
  }
  const body = await parseRequiredJsonBody(request);
  const tokenSecret = requireString(body, 'tokenSecret');
  let result;
  // Exact-string match — tightened from substring includes() so future drift in
  // chatMembershipBinding's throw message is caught instead of silently passing.
  const NO_HANDLE_THROW_MESSAGE = 'token has no handle — admin must mint with --handle';
  try {
    result = bindTokenToRoomMembership({ tokenSecret, roomId });
  } catch (failure) {
    if (failure instanceof Error && failure.message === NO_HANDLE_THROW_MESSAGE) {
      throw error(400, 'token has no handle');
    }
    // Any other thrown error is unexpected. Do not leak its message; surface
    // a generic server-side failure to avoid disclosing internal state.
    throw error(500, 'membership bind failed');
  }
  if (!result) {
    throw error(401, 'invite cannot be used');
  }
  return json({
    room: result.room,
    member: result.member,
    identity: result.identity
  });
};
