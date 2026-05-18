import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';

function requireActiveChatSession(sessionId: string) {
  const session = queries.getSession(sessionId) as any;
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
  if (session.type !== 'chat') throw error(400, 'Read receipts are only available for chat sessions');
  return session;
}

function requireMessageInSession(messageId: string, sessionId: string) {
  const message = queries.getMessage(messageId) as any;
  if (!message || message.session_id !== sessionId) throw error(404, 'Message not found');
  return message;
}

// POST /api/sessions/:id/messages/:msgId/read — mark message as read
// Body: { reader_id: string } — the session ID of the reader
export async function POST(event: RequestEvent<{ id: string; msgId: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const { params, request } = event;

  requireActiveChatSession(params.id);
  requireMessageInSession(params.msgId, params.id);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const reader_id = typeof body?.reader_id === 'string' ? body.reader_id.trim() : '';
  if (!reader_id) return json({ error: 'reader_id required' }, { status: 400 });
  if (!queries.getSession(reader_id)) throw error(404, 'Reader session not found');

  queries.markRead(params.msgId, reader_id);

  const reads = queries.getReadsForMessage(params.msgId) as any[];

  // Broadcast to all clients in this chat session
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, {
    type: 'message_read',
    sessionId: params.id,
    messageId: params.msgId,
    readerId: reader_id,
    reads,
  });

  return json({ ok: true, reads });
}

// GET /api/sessions/:id/messages/:msgId/read — get read receipts for a message
export function GET(event: RequestEvent<{ id: string; msgId: string }>) {
  assertSameRoom(event, event.params.id);
  const { params } = event;

  requireActiveChatSession(params.id);
  requireMessageInSession(params.msgId, params.id);
  const reads = queries.getReadsForMessage(params.msgId);
  return json({ reads });
}
