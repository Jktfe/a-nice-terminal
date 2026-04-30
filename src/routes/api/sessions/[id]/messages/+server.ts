import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';
import { assertNotRoomScoped } from '$lib/server/room-scope';

const RESOLVED_AGENT_EVENT_STATUSES = new Set(['discarded', 'dismissed', 'settled', 'responded']);

function terminalIdsForAgentEvent(chatId: string, message: any): string[] {
  const ids = new Set<string>();

  if (message.sender_id) {
    const sender = queries.getSession(message.sender_id) || queries.getSessionByHandle(message.sender_id);
    ids.add(sender?.id || message.sender_id);
  }

  try {
    const linkedTerminals = queries.getTerminalsByLinkedChat(chatId) as any[];
    for (const terminal of linkedTerminals) {
      if (terminal?.id) ids.add(terminal.id);
    }
  } catch {}

  return [...ids];
}

// PATCH /api/sessions/:id/messages?msgId= — update meta (reactions, bookmarks)
export async function PATCH(event: RequestEvent<{ id: string }>) {
  // Mutating arbitrary message meta (status flags, etc.) is admin-only —
  // there's no per-message ownership check yet, so a remote ANT could
  // change anyone's message metadata otherwise. Sender-bound editing is
  // a planned follow-up.
  assertNotRoomScoped(event);
  const { params, url, request } = event;
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

  if (existing.msg_type === 'agent_event' && RESOLVED_AGENT_EVENT_STATUSES.has(merged.status)) {
    const { discardEvent } = await import('$lib/server/agent-event-bus.js');
    const terminalIds = terminalIdsForAgentEvent(params.id, existing);
    for (const terminalSessionId of terminalIds) {
      discardEvent(terminalSessionId, msgId);
    }
  }

  return json({ msgId, meta: merged });
}

// DELETE /api/sessions/:id/messages?msgId=
export async function DELETE(event: RequestEvent<{ id: string }>) {
  // Same reasoning as PATCH — admin-only until per-message ownership lands.
  assertNotRoomScoped(event);
  const { params, url } = event;
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
  const { role, content, format, sender_id, target, reply_to, msg_type, meta } = await request.json();
  const id = nanoid();
  const msgType = msg_type || 'message';
  const replyTo = reply_to || null;
  const metaJson = meta === undefined
    ? '{}'
    : (typeof meta === 'string' ? meta : JSON.stringify(meta ?? {}));
  let parsedMeta: Record<string, any> = {};
  try { parsedMeta = JSON.parse(metaJson || '{}'); } catch {}
  const urgentRequested = parsedMeta.urgent === true || parsedMeta.urgent_bypass === true || parsedMeta.focus_bypass === true;
  const urgentReason = typeof parsedMeta.urgent_reason === 'string' ? parsedMeta.urgent_reason.trim()
    : typeof parsedMeta.bypass_reason === 'string' ? parsedMeta.bypass_reason.trim()
      : typeof parsedMeta.reason === 'string' ? parsedMeta.reason.trim()
        : '';
  if (urgentRequested && !urgentReason) {
    return json({ error: 'urgent/focus bypass requires a reason' }, { status: 400 });
  }

  if (msgType === 'agent_response') {
    try {
      const payload = JSON.parse(content);
      const sourceEvent = payload.event_id ? queries.getMessage(payload.event_id) as any : null;
      const terminalSessionId = payload.terminal_session_id || sourceEvent?.sender_id;
      const eventContent = payload.event_content || sourceEvent?.content;

      if (!terminalSessionId || !eventContent) {
        return json({ error: 'agent_response requires an event_id or terminal_session_id/event_content' }, { status: 400 });
      }

      const terminal = queries.getSession(terminalSessionId) as any;
      if (!terminal || terminal.type !== 'terminal') {
        return json({ error: 'agent_response target terminal not found' }, { status: 404 });
      }

      const sender = resolveSenderSession(sender_id);
      const { handleResponse } = await import('$lib/server/agent-event-bus.js');
      await handleResponse(
        terminalSessionId,
        eventContent,
        { type: payload.type, ...(payload.choice ?? {}) },
        payload.event_id ?? sourceEvent?.id ?? null,
        {
          responseMsgId: null,
          responderId: sender_id || null,
          responderName: sender.name,
          justification: payload.justification ?? payload.reason ?? null,
          source: String(payload.source ?? parsedMeta.source ?? 'linked_chat'),
        },
      );

      return json({
        id,
        session_id: params.id,
        role,
        format: format || 'json',
        status: 'complete',
        sender_id: sender_id || null,
        target: target || null,
        reply_to: replyTo,
        msg_type: msgType,
        handled: true,
        deliveries: [{
          adapter: 'agent-event-bus',
          targetId: terminalSessionId,
          delivered: true,
        }],
      });
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, { status: 500 });
    }
  }

  if (replyTo) {
    const parent: any = queries.getMessage(replyTo);
    if (!parent || parent.session_id !== params.id) {
      return json({ error: 'reply_to must reference a message in this session' }, { status: 400 });
    }
  }

  // 1. Persist to DB
  queries.createMessage(
    id, params.id, role, content, format || 'text', 'complete',
    sender_id || null, target || null, replyTo, msgType, metaJson
  );
  queries.updateSession(null, null, null, null, params.id);

  const msg = {
    id, session_id: params.id, role, content,
    format: format || 'text', status: 'complete',
    sender_id: sender_id || null, target: target || null, reply_to: replyTo, msg_type: msgType,
    meta: metaJson,
  };

  // Auto-populate chat_room_members when a sender posts —
  // only if sender_id resolves to an actual session (not a bare @handle with no session)
  if (sender_id) {
    try {
      const senderSess = queries.getSession(sender_id) || queries.getSessionByHandle(sender_id);
      if (senderSess) {
        const memberRole = senderSess.type === 'terminal' ? 'participant' : 'external';
        let cliFlag: string | null = null;
        try { cliFlag = senderSess.cli_flag || JSON.parse(senderSess.meta || '{}').agent_driver || null; } catch {}
        const alias = senderSess.handle || null;
        queries.addRoomMember(params.id, senderSess.id, memberRole, cliFlag, alias);
      }
    } catch {}
  }

  // 2. Route via MessageRouter
  const { getRouter } = await import('$lib/server/message-router.js');
  const router = getRouter();
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
    replyTo,
    msgType,
    meta: metaJson,
  });

  // 3. Return with delivery info
  return json({ ...msg, deliveries: result.deliveries }, { status: 201 });
}
