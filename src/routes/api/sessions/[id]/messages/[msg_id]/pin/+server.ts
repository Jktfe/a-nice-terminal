import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

// PATCH /api/sessions/:id/messages/:msg_id/pin — toggle pin status
export async function PATCH({ params, request }: RequestEvent<{ id: string; msg_id: string }>) {
  const { pinned } = await request.json();
  
  if (typeof pinned !== 'boolean') {
    return json({ error: 'pinned (boolean) required' }, { status: 400 });
  }

  // Check message exists
  const msg = queries.listMessages(params.id).find((m: any) => m.id === params.msg_id);
  if (!msg) {
    return json({ error: 'message not found' }, { status: 404 });
  }

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
