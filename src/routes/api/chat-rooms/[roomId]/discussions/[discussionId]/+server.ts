/**
 * Per-discussion endpoint — close with a decision summary.
 * (JWPK 2026-05-16 final-5 verb spec: chat-decide.)
 *
 * PATCH /api/chat-rooms/:roomId/discussions/:discussionId
 *   Body: { decision: string, pidChain?: PidChainEntry[] }
 *   → 200 { discussion }  — closes the discussion (status=closed),
 *                            records the decision as the summary,
 *                            stamps closed_by + closed_at.
 *   → 400 missing/blank decision
 *   → 403 identity not resolvable in this room
 *   → 404 roomId or discussionId not found / not in this room
 *
 * Backs `ant chat decide <discussionId> <decision>`. The store layer
 * (`closeOrReCloseDiscussion`) is reused unchanged; this route just
 * adds the HTTP surface that was missing.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import {
  getDiscussion,
  closeOrReCloseDiscussion
} from '$lib/server/chatDiscussionStore';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId ?? '';
  const discussionId = params.discussionId ?? '';
  if (!doesChatRoomExist(roomId)) throw error(404, 'Room not found.');
  const existing = getDiscussion(discussionId);
  if (!existing) throw error(404, 'Discussion not found.');
  if (existing.room_id !== roomId) {
    throw error(404, 'Discussion not in this room.');
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with a decision field.');
  }

  const decisionRaw = (rawBody as { decision?: unknown }).decision;
  if (typeof decisionRaw !== 'string' || decisionRaw.trim().length === 0) {
    throw error(400, 'decision must be a non-empty string.');
  }

  // Strict identity (mirrors discussions POST). Caller must be a known
  // member of the room — no warning-phase fallback.
  const handle = resolveCallerIdentityStrict(roomId, request, rawBody);

  const updated = closeOrReCloseDiscussion({
    discussionId,
    summary: decisionRaw.trim(),
    closed_by: handle
  });

  return json({ discussion: updated });
};
