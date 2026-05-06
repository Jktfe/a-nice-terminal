// POST /api/sessions/:id/publish-summary
// M2 #2 — Publish interview summary from linked chat back to origin room.
// The linked chat id is the route param; the origin room id is read from
// the linked chat's meta (set by start-interview). The request body carries
// the structured summary buckets.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { buildPublishSummary, renderSummaryMarkdown } from '$lib/server/interview/publish-summary.js';
import { nanoid } from 'nanoid';

export async function POST({ params, request, url }: RequestEvent) {
  const linkedChatId = params.id!;
  const body = await request.json().catch(() => ({}));

  const linkedChat = queries.getSession(linkedChatId);
  if (!linkedChat) throw error(404, 'Linked chat not found');

  // Read origin_room_id from the linked chat's meta blob
  let originRoomId: string | null = null;
  try {
    const meta = JSON.parse(linkedChat.meta || '{}');
    originRoomId = meta.origin_room_id ?? null;
  } catch {}
  if (!originRoomId) throw error(400, 'Linked chat has no origin_room_id');

  // Validate origin room exists
  const originRoom = queries.getSession(originRoomId);
  if (!originRoom) throw error(404, 'Origin room not found');

  // Build the summary
  const summary = buildPublishSummary({
    title: typeof body.title === 'string' ? body.title : 'Interview Summary',
    findings: body.findings,
    decisions: body.decisions,
    asks: body.asks,
    actions: body.actions,
    sources: body.sources,
    linkedChatId,
    originRoomId,
    authoredBy: typeof body.authored_by === 'string' ? body.authored_by : null,
    generatedAtMs: typeof body.generated_at_ms === 'number' ? body.generated_at_ms : Date.now(),
  });

  const transcriptUrl = `${url.origin}/session/${linkedChatId}`;
  const markdown = renderSummaryMarkdown(summary, { transcriptUrl });

  // Post to origin room as a message
  const msgId = nanoid();
  const now = new Date().toISOString();
  queries.createMessage(
    msgId,
    originRoomId,
    'assistant',
    markdown,
    'markdown',
    'complete',
    null,
    null,
    null,
    'interview_summary',
    JSON.stringify({
      interview_summary: true,
      linked_chat_id: linkedChatId,
      schema_version: summary.schema_version,
      generated_at_ms: summary.generated_at_ms,
    }),
  );

  // Broadcast to origin room
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(originRoomId, {
    type: 'message',
    sessionId: originRoomId,
    id: msgId,
    role: 'assistant',
    content: markdown,
    format: 'markdown',
    status: 'complete',
    sender_id: null,
    target: null,
    reply_to: null,
    msg_type: 'interview_summary',
    meta: JSON.stringify({ interview_summary: true, linked_chat_id: linkedChatId }),
    created_at: now,
  });

  return json({ ok: true, message_id: msgId, origin_room_id: originRoomId });
}
