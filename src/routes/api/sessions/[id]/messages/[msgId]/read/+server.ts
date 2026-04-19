import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

// POST /api/sessions/:id/messages/:msgId/read — mark message as read
// Body: { reader_id: string } — the session ID of the reader
export async function POST({ params, request }: RequestEvent<{ id: string; msgId: string }>) {
  const { reader_id } = await request.json();
  if (!reader_id) return json({ error: 'reader_id required' }, { status: 400 });

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
export function GET({ params }: RequestEvent<{ id: string; msgId: string }>) {
  const reads = queries.getReadsForMessage(params.msgId);
  return json({ reads });
}
