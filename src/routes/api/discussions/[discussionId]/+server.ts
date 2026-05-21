/**
 * src/routes/api/discussions/[discussionId]/+server.ts (M3.4b)
 *
 * GET   → read the discussion + filtered child messages (no pidChain required)
 * PATCH → close-or-re-close with summary (identity-gated, idempotent per Q4-4b)
 *
 * No separate /close sub-path: PATCH-on-root per Q5 (per @evolveantclaude
 * lane-context 2026-05-13). On first PATCH: transitions open→closed +
 * stamps closed_by/closed_at/summary. On subsequent PATCH: updates summary
 * in place + re-stamps closed_by/closed_at. Empty summary always 400.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import {
  getDiscussion,
  closeOrReCloseDiscussion
} from '$lib/server/chatDiscussionStore';

export const GET: RequestHandler = async ({ params }) => {
  const discussion = getDiscussion(params.discussionId);
  if (!discussion) throw error(404, 'Discussion not found.');
  // Inner messages filtered by discussion_id; per B3 messages are in-memory
  // until rooms-persistence ships.
  const messages = listMessagesInRoom(discussion.room_id).filter(
    (m) => (m as { discussion_id?: string }).discussion_id === discussion.id
  );
  return json({ discussion, messages });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const discussion = getDiscussion(params.discussionId);
  if (!discussion) throw error(404, 'Discussion not found.');

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');

  const summaryRaw = (rawBody as { summary?: unknown }).summary;
  if (typeof summaryRaw !== 'string' || summaryRaw.trim().length === 0) {
    throw error(400, 'summary (non-empty string) is required.');
  }

  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) throw error(400, 'pidChain is required for discussion writes.');
  const handle = resolveServerSideHandle(discussion.room_id, pidChain);
  if (!handle) throw error(403, 'Caller is not a registered member of this room.');

  const updated = closeOrReCloseDiscussion({
    discussionId: discussion.id,
    summary: summaryRaw.trim(),
    closed_by: handle
  });
  return json({ discussion: updated });
};
