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
  const limit = parseInt(url.searchParams.get('limit') || '50');

  const messages = since
    ? queries.getMessagesSince(params.id, since, limit)
    : queries.listMessages(params.id);
  return json({ messages });
}

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const { role, content, format, sender_id, target, msg_type } = await request.json();
  const id = nanoid();
  const msgType = msg_type || 'message';

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

  // Broadcast to WS clients joined to this session, filtered by target
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'message_created', sessionId: params.id, ...msg }, target);

  // If message targets a handle, inject a notification into that terminal's PTY
  // so the AI running in that terminal sees it directly
  if (target && target !== '@everyone') {
    const targetSession: any = queries.getSessionByHandle(target);
    if (targetSession?.type === 'terminal') {
      const senderSession: any = sender_id ? queries.getSession(sender_id) : null;
      const senderName = senderSession?.name || sender_id || 'web';
      // Inject as a clearly delimited notification block — safe for bash and AI CLIs
      const notification =
        `\r\n\x1b[36m┌─ ANT message ─────────────────────────────────\x1b[0m\r\n` +
        `\x1b[36m│\x1b[0m From: \x1b[33m${senderName}\x1b[0m → \x1b[32m${target}\x1b[0m\r\n` +
        `\x1b[36m│\x1b[0m "${content.slice(0, 200)}"\r\n` +
        `\x1b[36m│\x1b[0m Reply: \x1b[90mant msg ${params.id} "your reply"\x1b[0m\r\n` +
        `\x1b[36m└───────────────────────────────────────────────\x1b[0m\r\n`;
      try {
        // ptyClient preferred; falls back gracefully if session not in daemon
        const { ptyClient } = await import('$lib/server/pty-client.js');
        ptyClient.write(targetSession.id, notification);
      } catch {}
    }
  }

  return json(msg, { status: 201 });
}
