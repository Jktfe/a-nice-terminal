import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

// PATCH /api/sessions/:id/messages?msgId= — update meta (reactions, bookmarks)
export async function PATCH({ params, url, request }: RequestEvent<{ id: string }>) {
  const msgId = url.searchParams.get('msgId');
  if (!msgId) return json({ error: 'msgId required' }, { status: 400 });

  const { meta } = await request.json();
  if (!meta) return json({ error: 'meta required' }, { status: 400 });

  // Fetch existing meta and merge
  const existing: any = queries.listMessages(params.id).find((m: any) => m.id === msgId);
  if (!existing) return json({ error: 'not found' }, { status: 404 });

  let existingMeta: any = {};
  try { existingMeta = JSON.parse(existing.meta || '{}'); } catch {}
  const merged = { ...existingMeta, ...meta };

  queries.updateMessageMeta(msgId, JSON.stringify(merged));

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'message_updated', sessionId: params.id, msgId, meta: merged });

  return json({ msgId, meta: merged });
}

// DELETE /api/sessions/:id/messages?msgId=
export async function DELETE({ params, url }: RequestEvent<{ id: string }>) {
  const msgId = url.searchParams.get('msgId');
  if (!msgId) return json({ error: 'msgId required' }, { status: 400 });

  queries.deleteMessage(msgId);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'message_deleted', sessionId: params.id, msgId });

  return json({ ok: true });
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const since = url.searchParams.get('since');
  const before = url.searchParams.get('before');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  let messages: unknown[];
  if (before) {
    // Backward pagination: fetch older messages before a given timestamp/id,
    // returned DESC from DB then reversed so caller gets ASC order.
    const rows = queries.getMessagesBefore(params.id, before, limit) as unknown[];
    messages = (rows as unknown[]).reverse();
  } else if (since) {
    messages = queries.getMessagesSince(params.id, since, limit) as unknown[];
  } else {
    messages = queries.listMessages(params.id) as unknown[];
  }
  return json({ messages });
}

/** Resolve the sender session to get name/type for routing context. */
function resolveSenderSession(senderId: string | null): { name: string; type: string | null } {
  if (!senderId) return { name: 'web', type: null };
  const session: any = queries.getSession(senderId) || queries.getSessionByHandle(senderId);
  return {
    name: session?.display_name || session?.name || senderId,
    type: session?.type || null,
  };
}

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const { role, content, format, sender_id, target, msg_type } = await request.json();
  const id = nanoid();
  const msgType = msg_type || 'message';

  // 1. Persist to DB
  queries.createMessage(
    id, params.id, role, content, format || 'text', 'complete',
    sender_id || null, target || null, msgType, '{}'
  );
  queries.updateSession(null, null, null, null, params.id);

  const msg = {
    id, session_id: params.id, role, content,
    format: format || 'text', status: 'complete',
    sender_id: sender_id || null, target: target || null, msg_type: msgType,
  };

  // Auto-populate chat_room_members when a sender posts
  if (sender_id) {
    try {
      const senderSess = queries.getSession(sender_id) || queries.getSessionByHandle(sender_id);
      const memberRole = senderSess?.type === 'terminal' ? 'participant' : 'external';
      let cliFlag: string | null = null;
      try { cliFlag = senderSess?.cli_flag || JSON.parse(senderSess?.meta || '{}').agent_driver || null; } catch {}
      queries.addRoomMember(params.id, sender_id, memberRole, cliFlag);
    } catch {}
  }

  // 2. Route via MessageRouter
  const { getRouter } = await import('$lib/server/message-router.js');
  const router = getRouter();
  console.log(`[messages POST] router adapters: ${router.adapterCount ?? 'unknown'}, sessionId=${params.id}, sender_id=${sender_id}`);
  const sender = resolveSenderSession(sender_id);

  // Forward human messages to Claude channels — but ONLY for non-linked chat sessions
  // (group chats, standalone chats). Linked chat messages are terminal I/O and should
  // NOT spam the channel.
  const senderIsAgent = sender.type === 'terminal';
  const linkedTerminals = queries.getTerminalsByLinkedChat(params.id) as any[];
  const isLinkedChat = linkedTerminals.length > 0;
  if (!senderIsAgent && !isLinkedChat) {
    const channels = queries.listChannels() as { handle: string; port: number }[];
    const payload = JSON.stringify({ content: content.slice(0, 500), sender: sender.name || sender_id || 'chat', session_id: params.id });
    for (const ch of channels) {
      try {
        fetch(`http://127.0.0.1:${ch.port}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => {});
      } catch {}
    }
    // Fallback: always try port 8789 even if registry is empty
    if (!channels.some(c => c.port === 8789)) {
      try {
        fetch('http://127.0.0.1:8789', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => {});
      } catch {}
    }
  }

  const result = await router.route({
    id,
    sessionId: params.id,
    content,
    role,
    senderId: sender_id || null,
    senderName: sender.name,
    senderType: sender.type,
    target: target || null,
    msgType,
  });

  // 3. Return with delivery info
  return json({ ...msg, deliveries: result.deliveries }, { status: 201 });
}
