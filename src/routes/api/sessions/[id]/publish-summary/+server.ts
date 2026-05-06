// POST /api/sessions/:id/publish-summary
//
// M2 #2: thin wrapper over publishSummaryFromLinkedChat() in
// src/lib/server/interview/publish-summary-route.ts. The :id is the
// linked-chat session id; the helper resolves origin_room_id from the chat
// meta and posts a rendered markdown summary back into the origin room.

import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { publishSummaryFromLinkedChat } from '$lib/server/interview/publish-summary-route.js';

export async function POST({ params, request }: RequestEvent) {
  const linkedChatId = params.id!;
  const body = await request.json().catch(() => ({}));

  const result = publishSummaryFromLinkedChat(queries as any, linkedChatId, {
    title:         typeof body?.title === 'string' ? body.title : '',
    findings:      Array.isArray(body?.findings)  ? body.findings  : undefined,
    decisions:     Array.isArray(body?.decisions) ? body.decisions : undefined,
    asks:          Array.isArray(body?.asks)      ? body.asks      : undefined,
    actions:       Array.isArray(body?.actions)   ? body.actions   : undefined,
    sources:       Array.isArray(body?.sources)   ? body.sources   : undefined,
    authoredBy:    typeof body?.authored_by === 'string' ? body.authored_by : null,
    transcriptUrl: typeof body?.transcript_url === 'string' ? body.transcript_url : undefined,
  });

  if (!result.ok) {
    if (result.error === 'chat_not_found')    throw error(404, 'Linked chat not found');
    if (result.error === 'invalid_chat_type') throw error(400, `Session is not a chat: ${result.reason}`);
    if (result.error === 'no_origin_room')    throw error(400, 'Linked chat has no origin_room_id in meta');
    if (result.error === 'invalid_input')     throw error(400, `Invalid input: ${result.reason}`);
  }

  return json(result);
}
