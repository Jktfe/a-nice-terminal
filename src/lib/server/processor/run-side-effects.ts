// Phase B of server-split-2026-05-11 — Tier 2 entry point. Consumes a
// WriteMessageResult (or reconstructs one from a DB row during Phase
// C replay) and runs every side effect that requires the live
// server: channel HTTP fanout, MessageRouter.route, agent event bus
// emit, global ask broadcast, asks WS broadcast. On success flips
// broadcast_state to 'done'. On exception bumps broadcast_attempts;
// after 5 attempts the row is marked 'failed' and the catch-up loop
// in Phase C will stop replaying it.
//
// What this function does NOT do:
//   - It does NOT call inferAskFromMessage. Ask creation is Tier 1
//     (writeAsksForMessage in src/lib/persist/ask-writes.ts). On a
//     replay this function only re-broadcasts the WS envelopes for
//     asks that were created in the original transaction.
//   - It does NOT handle agent_response. That path holds in-memory
//     event-bus state and stays in the HTTP handler.
//
// Idempotency contract:
//   - Channel HTTP fanout is non-idempotent. We reuse delivery_log
//     to skip adapters that already returned delivered=1.
//   - router.route + ask WS broadcast log their delivery for replay
//     visibility but do NOT skip on duplicates (the consumers dedupe
//     by message id at their layer).

import { queries } from '$lib/server/db';
import { emitAskRunEvent } from '$lib/server/ask-events';
import { broadcastQueue } from '$lib/persist';
import type { WriteMessageResult } from '$lib/persist';

const MAX_BROADCAST_ATTEMPTS = 5;
const CHANNEL_FALLBACK_PORT = 8789;
const CHANNEL_FALLBACK_ADAPTER = `channel:${CHANNEL_FALLBACK_PORT}`;

export interface RunSideEffectsOptions {
  /** Reserved for Phase C — when true, side effects know they are
   *  being replayed (used for the PTY-injection age guard, etc.).
   *  Phase B sets this to false for live posts; Phase C sets true. */
  replay?: boolean;
}

export interface DeliveryReport {
  adapter: string;
  delivered: boolean;
  error?: string;
}

export interface RunSideEffectsResult {
  deliveries: DeliveryReport[];
  routedDeliveries: unknown[];
}

function hasDelivered(messageId: string, adapter: string): boolean {
  return Boolean(queries.hasDelivered(messageId, adapter));
}

function recordDelivery(
  messageId: string,
  sessionId: string,
  adapter: string,
  delivered: boolean,
  error: string | null,
) {
  try {
    queries.logDelivery(messageId, sessionId, adapter, delivered ? 1 : 0, error);
  } catch {
    // delivery_log is observability; never break the post over it.
  }
}

function fireChannelFanout(
  messageId: string,
  sessionId: string,
  content: string,
  senderLabel: string,
  reports: DeliveryReport[],
): void {
  const channels = queries.listChannels() as { handle: string; port: number }[];
  const payload = JSON.stringify({
    content: typeof content === 'string' ? content.slice(0, 500) : '',
    sender: senderLabel,
    session_id: sessionId,
  });

  function fireOne(adapter: string, port: number) {
    if (hasDelivered(messageId, adapter)) {
      reports.push({ adapter, delivered: true });
      return;
    }
    try {
      fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
        .then((res) => {
          if (res.ok) {
            recordDelivery(messageId, sessionId, adapter, true, null);
          } else {
            recordDelivery(messageId, sessionId, adapter, false, `HTTP ${res.status}`);
          }
        })
        .catch((err) => {
          recordDelivery(messageId, sessionId, adapter, false, String(err?.message ?? err));
        });
      reports.push({ adapter, delivered: true });
    } catch (err) {
      recordDelivery(messageId, sessionId, adapter, false, String((err as any)?.message ?? err));
      reports.push({ adapter, delivered: false, error: String((err as any)?.message ?? err) });
    }
  }

  for (const ch of channels) {
    fireOne(`channel:${ch.handle}`, ch.port);
  }
  // Fallback: always try the legacy 8789 port if the registry is empty.
  // Preserves verbatim the Phase A handler behaviour.
  if (!channels.some((c) => c.port === CHANNEL_FALLBACK_PORT)) {
    fireOne(CHANNEL_FALLBACK_ADAPTER, CHANNEL_FALLBACK_PORT);
  }
}

async function runMessageRouter(result: WriteMessageResult): Promise<unknown[]> {
  const msg = result.message;
  const { getRouter } = await import('$lib/server/message-router.js');
  const router = getRouter();
  const routed = await router.route({
    id: msg.id,
    sessionId: msg.session_id,
    content: msg.content,
    role: msg.role,
    senderId: msg.sender_id,
    senderName: result.senderResolved.name,
    senderType: result.senderResolved.type,
    target: msg.target,
    replyTo: msg.reply_to,
    msgType: msg.msg_type,
    meta: msg.meta,
  });
  return routed?.deliveries ?? [];
}

async function broadcastAsks(result: WriteMessageResult): Promise<void> {
  if (result.asks.length === 0) return;
  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  for (const ask of result.asks) {
    emitAskRunEvent('ask_created', ask);
    broadcast(result.message.session_id, {
      type: 'ask_created',
      sessionId: result.message.session_id,
      ask,
    });
    broadcastGlobal({
      type: 'ask_created',
      sessionId: result.message.session_id,
      ask,
    });
  }
}

export async function runSideEffects(
  result: WriteMessageResult,
  opts: RunSideEffectsOptions = {},
): Promise<RunSideEffectsResult> {
  const msg = result.message;
  const deliveries: DeliveryReport[] = [];

  try {
    // 1. Channel HTTP fanout — only for non-agent senders posting to a
    //    non-linked chat. This is the non-idempotent path that uses
    //    delivery_log to make replays safe.
    const senderIsAgent = result.senderResolved.type === 'terminal';
    if (!senderIsAgent && !result.isLinkedChat) {
      fireChannelFanout(
        msg.id,
        msg.session_id,
        typeof msg.content === 'string' ? msg.content : '',
        result.senderResolved.name || msg.sender_id || 'chat',
        deliveries,
      );
    }

    // 2. MessageRouter.route (WS broadcast, PTY injection on live path).
    //    Phase C's replay path will use opts.replay + an age guard to
    //    skip PTY injection on stale messages; that lives in Phase C.
    const routedDeliveries = await runMessageRouter(result);
    deliveries.push({ adapter: 'router', delivered: true });
    recordDelivery(msg.id, msg.session_id, 'router', true, null);

    // 3. Asks WS broadcast. emitAskRunEvent + per-ask broadcast +
    //    global broadcast. No re-creation of asks on replay (Tier 1
    //    owns ask creation per serverSplit.md).
    await broadcastAsks(result);
    if (result.asks.length > 0) {
      deliveries.push({ adapter: 'ws-asks', delivered: true });
      recordDelivery(msg.id, msg.session_id, 'ws-asks', true, null);
    }

    // 4. Flip broadcast_state from 'pending' to 'done'.
    broadcastQueue.markDone(msg.id);

    return { deliveries, routedDeliveries };
  } catch (err) {
    // Track failures: bump attempts, mark failed after MAX_BROADCAST_ATTEMPTS.
    broadcastQueue.bumpAttempts(msg.id);
    const row: any = queries.getMessage(msg.id);
    if ((row?.broadcast_attempts ?? 0) >= MAX_BROADCAST_ATTEMPTS) {
      broadcastQueue.markFailed(msg.id);
    }
    throw err;
  }
}
