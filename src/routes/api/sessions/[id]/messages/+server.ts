import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';
import { assertNotRoomScoped, assertCanWrite } from '$lib/server/room-scope';
import { emitAskRunEvent } from '$lib/server/ask-events';
import { CHAT_BREAK_MSG_TYPE, loadMessagesForAgentContext } from '$lib/server/chat-context';
import { writeMessage, WriteMessageError, resolveSenderSession as resolvePersistedSender, broadcastQueue } from '$lib/persist';

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
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam) : 50;
  const agentContext = url.searchParams.get('agent_context') === '1' || url.searchParams.get('context') === 'agent';

  let messages: unknown[];
  if (agentContext) {
    const rows = loadMessagesForAgentContext(params.id, { since, limit: before ? undefined : limit });
    messages = before
      ? rows.filter((m) => m.created_at < before).slice(-limit)
      : rows;
  } else if (before) {
    // Backward pagination: fetch older messages before a given timestamp/id,
    // returned DESC from DB then reversed so caller gets ASC order.
    const rows = queries.getMessagesBefore(params.id, before, limit) as unknown[];
    messages = (rows as unknown[]).reverse();
  } else if (since) {
    messages = queries.getMessagesSince(params.id, since, limit) as unknown[];
  } else if (limitParam) {
    // Bounded latest-N fetch — DESC then reverse for ASC delivery.
    // The previous unbounded path silently ignored ?limit=, returning every
    // message in the room on every page load.
    const rows = queries.getLatestMessages(params.id, limit) as unknown[];
    messages = (rows as unknown[]).reverse();
  } else {
    messages = queries.listMessages(params.id) as unknown[];
  }
  return json({ messages });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  // Read-only kinds (web viewer) must NOT be able to escalate to posting via
  // direct curl. The kind annotation on the bearer is the gate.
  assertCanWrite(event);
  const { params, request } = event;
  const body = await request.json();
  const { role, content, format, sender_id, target, reply_to, msg_type, meta, asks } = body;
  const msgType = msg_type || 'message';

  // agent_response is a special path that short-circuits BEFORE persist.
  // It depends on handleResponse() which holds in-memory event-bus state
  // — Tier 1 (writeMessage) does not handle it (serverSplit.md Risks).
  if (msgType === 'agent_response') {
    const id = nanoid();
    let parsedMeta: Record<string, any> = {};
    try {
      const metaJson = meta === undefined ? '{}' : typeof meta === 'string' ? meta : JSON.stringify(meta ?? {});
      parsedMeta = JSON.parse(metaJson || '{}');
    } catch {}
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

      const sender = resolvePersistedSender(sender_id || null);
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
        reply_to: reply_to || null,
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

  // Phase A of server-split-2026-05-11 — Tier 1 persist via writeMessage.
  // All DB mutations (createMessage, ask writes, meta rewrite, room
  // membership upsert) run in a single transaction inside the persist
  // library. The side-effect block below stays inline for now; Phase B
  // extracts it into runSideEffects().
  let result;
  try {
    result = writeMessage({
      sessionId: params.id,
      role,
      content,
      format,
      senderId: sender_id || null,
      target: target || null,
      replyTo: reply_to || null,
      msgType,
      meta,
      asks,
      source: 'http',
    });
  } catch (e) {
    if (e instanceof WriteMessageError) {
      return json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { message: msg, asks: createdAsks, firstPost, isLinkedChat, senderResolved } = result;

  // 2. Route via MessageRouter — stays inline for Phase A; Phase B moves
  // this block plus the channel fanout + WS broadcast into runSideEffects.
  const { getRouter } = await import('$lib/server/message-router.js');
  const router = getRouter();

  // Forward human messages to Claude channels — but ONLY for non-linked chat sessions
  // (group chats, standalone chats). Linked chat messages are terminal I/O and should
  // NOT spam the channel.
  const senderIsAgent = senderResolved.type === 'terminal';
  if (!senderIsAgent && !isLinkedChat) {
    const channels = queries.listChannels() as { handle: string; port: number }[];
    const payload = JSON.stringify({
      content: typeof msg.content === 'string' ? msg.content.slice(0, 500) : '',
      sender: senderResolved.name || sender_id || 'chat',
      session_id: params.id,
    });
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

  const routed = await router.route({
    id: msg.id,
    sessionId: params.id,
    content: msg.content,
    role: msg.role,
    senderId: msg.sender_id,
    senderName: senderResolved.name,
    senderType: senderResolved.type,
    target: msg.target,
    replyTo: msg.reply_to,
    msgType: msg.msg_type,
    meta: msg.meta,
  });

  if (createdAsks.length > 0) {
    const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
    for (const ask of createdAsks) {
      emitAskRunEvent('ask_created', ask);
      broadcast(params.id, { type: 'ask_created', sessionId: params.id, ask });
      broadcastGlobal({ type: 'ask_created', sessionId: params.id, ask });
    }
  }

  // Phase A of server-split-2026-05-11 — side effects ran successfully
  // (or at least did not throw all the way out of the handler), so the
  // row is no longer a candidate for the Phase C catch-up loop. Flip
  // broadcast_state to 'done' BEFORE returning so a future replay
  // cannot resurrect a message that was already broadcast. If the
  // handler throws anywhere above this line the row stays 'pending'
  // and Phase C will replay it once the catch-up loop ships — that is
  // the intended retry semantic, not a bug.
  broadcastQueue.markDone(msg.id);

  // 3. Return with delivery info + first-post hint when applicable.
  // The hint is a single line with no skill body — agents fetch the
  // actual skill via `ant skill <name>` only when they need it.
  // Lives on the response so the CLI can surface it client-side
  // without an extra round-trip.
  const skillHint = firstPost
    ? 'tip: run `ant skill list` to see ANT helper skills (planning, chat-routing, chat-break, task-lifecycle, artefacts) — saves tokens vs re-explaining.'
    : null;

  return json({
    ...msg,
    ask: createdAsks[0] ?? null,
    asks: createdAsks,
    deliveries: routed.deliveries,
    ...(skillHint ? { firstPost: true, hint: skillHint } : {}),
  }, { status: 201 });
}
