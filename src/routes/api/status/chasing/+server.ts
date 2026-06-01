/**
 * GET /api/status/chasing?handle=@h&min-idle-minutes=30
 *
 * Returns threads where the caller's `handle` is the most-recent
 * non-system speaker in the room and the message is at least
 * `min-idle-minutes` minutes old.
 *
 * v1 definition (one row per room — the chasing message itself):
 *   - room.deleted_at_ms IS NULL AND room.archived_at_ms IS NULL
 *   - caller is a chat_room_members row for the room
 *   - the message has the highest post_order among non-system messages
 *     in that room
 *   - author_handle = handle
 *   - posted_at <= now - min-idle-minutes
 *
 * Response shape: { messages: ChatMessage[] } oldest-first.
 *
 * Errors:
 *   400 — missing or blank handle query param
 *   400 — non-numeric or negative min-idle-minutes
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listChasingForHandle } from '$lib/server/pendingMessagesStore';

const DEFAULT_MIN_IDLE_MINUTES = 30;

export const GET: RequestHandler = ({ url }) => {
  const handleRaw = url.searchParams.get('handle');
  if (handleRaw === null || handleRaw.trim().length === 0) {
    throw error(400, 'handle query parameter is required.');
  }

  let minIdleMinutes = DEFAULT_MIN_IDLE_MINUTES;
  const minIdleRaw = url.searchParams.get('min-idle-minutes');
  if (minIdleRaw !== null && minIdleRaw.length > 0) {
    const parsed = Number(minIdleRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw error(400, 'min-idle-minutes must be a non-negative number.');
    }
    minIdleMinutes = parsed;
  }

  const messages = listChasingForHandle(handleRaw, minIdleMinutes);
  return json({ messages });
};
