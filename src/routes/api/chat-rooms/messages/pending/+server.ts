/**
 * GET /api/chat-rooms/messages/pending?handle=@h&since=1715800000000
 *
 * Returns messages addressed to the caller's `handle` that the caller
 * has not yet threaded a reply to, across every room the caller is a
 * member of.
 *
 * v1 definition (kept simple — pendingMessagesStore docstring is the
 * canonical reference):
 *   - author_handle != handle
 *   - kind IN ('human','agent')
 *   - body contains the literal "@handle" token (LIKE %@handle%)
 *   - no descendant message has parent_message_id = m.id AND
 *     author_handle = handle
 *   - optional `since` epoch-ms lower bound on posted_at
 *
 * Response shape: { messages: ChatMessage[] } oldest-first by global
 * post_order ASC.
 *
 * Errors:
 *   400 — missing or blank handle query param
 *   400 — non-numeric `since`
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPendingForHandle } from '$lib/server/pendingMessagesStore';

export const GET: RequestHandler = ({ url }) => {
  const handleRaw = url.searchParams.get('handle');
  if (handleRaw === null || handleRaw.trim().length === 0) {
    throw error(400, 'handle query parameter is required.');
  }

  let sinceMs: number | undefined;
  const sinceRaw = url.searchParams.get('since');
  if (sinceRaw !== null && sinceRaw.length > 0) {
    const parsed = Number(sinceRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw error(400, 'since must be a non-negative epoch-ms integer.');
    }
    sinceMs = parsed;
  }

  const messages = listPendingForHandle(handleRaw, sinceMs);
  return json({ messages });
};
