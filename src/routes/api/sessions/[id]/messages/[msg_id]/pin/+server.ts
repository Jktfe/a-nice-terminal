import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';

function requireActiveChatSession(sessionId: string) {
  const session = queries.getSession(sessionId) as any;
  if (!session) {
    throw error(404, 'Session not found');
  }
  if (session.archived || session.deleted_at) {
    throw error(410, 'Session is inactive');
  }
  if (session.type !== 'chat') {
    throw error(400, 'Pinned messages are only available for chat sessions');
  }
  return session;
}

function requireMessageInSession(messageId: string, sessionId: string) {
  const message = queries.getMessage(messageId) as any;
  if (!message || message.session_id !== sessionId) {
    throw error(404, 'message not found');
  }
  return message;
}

// PATCH /api/sessions/:id/messages/:msg_id/pin — toggle pin status
export async function PATCH(event: RequestEvent<{ id: string; msg_id: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const { params, request } = event;

  requireActiveChatSession(params.id);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { pinned } = body ?? {};
  
  if (typeof pinned !== 'boolean') {
    return json({ error: 'pinned (boolean) required' }, { status: 400 });
  }

  requireMessageInSession(params.msg_id, params.id);

  queries.togglePinMessage(params.msg_id, pinned);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { 
    type: 'message_pinned', 
    sessionId: params.id, 
    msgId: params.msg_id, 
    pinned 
  });

  return json({ msgId: params.msg_id, pinned });
}
