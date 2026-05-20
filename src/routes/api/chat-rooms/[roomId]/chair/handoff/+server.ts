/**
 * POST /api/chat-rooms/:roomId/chair/handoff — re-assign the chair role.
 *
 * M4.4 Q2 semantics: caller must be a current member of roomId (pidChain-
 * strict via resolveCallerIdentityStrict). toHandle must also be a member.
 * Idempotent: handing off to the current chair is a no-op (200, changed=
 * false). Every changed handoff appends a chat_room_chair_history audit
 * row and posts a system message into the room.
 *
 * Auth (Q4): pidChain-strict identity, same as discussions POST.
 *   - 403 missing/invalid identity
 *   - 404 unknown room
 *   - 400 missing toHandle
 *   - 404 toHandle not a member (ChairTargetNotMemberError)
 *   - 200 + { currentChairHandle, changed } on success
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { setRoomChair, getRoomChair, ChairTargetNotMemberError } from '$lib/server/chairHandoffStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with toHandle + pidChain.');
  }

  const setBy = resolveCallerIdentityStrict(params.roomId, request, rawBody);

  const toRaw = (rawBody as { toHandle?: unknown }).toHandle;
  if (typeof toRaw !== 'string' || toRaw.length === 0) {
    throw error(400, 'toHandle (string) is required.');
  }
  const toHandle = toRaw.startsWith('@') ? toRaw : `@${toRaw}`;

  const previousChair = getRoomChair(params.roomId);

  try {
    const result = setRoomChair({ roomId: params.roomId, toHandle, setBy });
    if (result.changed) {
      postSystemMessage({
        roomId: params.roomId,
        body: previousChair
          ? `${previousChair} handed chair to ${toHandle}.`
          : `${setBy} set chair to ${toHandle}.`
      });
    }
    return json(result);
  } catch (cause) {
    if (cause instanceof ChairTargetNotMemberError) {
      throw error(404, cause.message);
    }
    throw cause;
  }
};
