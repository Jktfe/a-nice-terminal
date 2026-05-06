import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import {
  normalizeAskAction,
  normalizeAskOwnerKind,
  normalizeAskPriority,
  normalizeAskStatus,
} from '$lib/server/ask-inference';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function publicAsk(row: any) {
  return {
    ...row,
    inferred: row.inferred === 1,
    confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence ?? 0),
    meta: parseJsonObject(row.meta),
  };
}

function getScopedAsk(params: { id: string; askId: string }) {
  const ask = queries.getAsk(params.askId) as any;
  if (!ask || ask.session_id !== params.id) return null;
  return ask;
}

function syncSourceMessage(ask: any) {
  if (!ask.source_message_id) return null;
  try {
    const source = queries.getMessage(ask.source_message_id) as any;
    const sourceMeta = parseJsonObject(source?.meta);
    const askIds = Array.isArray(sourceMeta.ask_ids) ? sourceMeta.ask_ids : [];
    const idx = askIds.indexOf(ask.id);
    if (idx >= 0) {
      const resolved = new Set(
        Array.isArray(sourceMeta.asks_resolved)
          ? sourceMeta.asks_resolved.filter((n) => Number.isInteger(n))
          : [],
      );
      if (ask.status === 'answered' || ask.status === 'dismissed') resolved.add(idx);
      if (ask.status === 'open' || ask.status === 'candidate' || ask.status === 'deferred') resolved.delete(idx);
      sourceMeta.asks_resolved = Array.from(resolved).sort((a, b) => a - b);
    }
    const nextMeta = {
      ...sourceMeta,
      ask_id: ask.id,
      ask_status: ask.status,
      ask_answer_action: ask.answer_action ?? null,
    };
    queries.updateMessageMeta(ask.source_message_id, JSON.stringify(nextMeta));
    return { sessionId: source.session_id, msgId: ask.source_message_id, meta: nextMeta };
  } catch {
    return null;
  }
}

export function GET(event: RequestEvent<{ id: string; askId: string }>) {
  assertSameRoom(event, event.params.id);
  const ask = getScopedAsk(event.params);
  if (!ask) return json({ error: 'not found' }, { status: 404 });
  return json({ ask: publicAsk(ask) });
}

export async function PATCH(event: RequestEvent<{ id: string; askId: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const existing = getScopedAsk(event.params);
  if (!existing) return json({ error: 'not found' }, { status: 404 });

  const body = await event.request.json();
  const action = normalizeAskAction(body.action ?? body.answer_action ?? body.answerAction);
  const status = body.status
    ? normalizeAskStatus(body.status, existing.status)
    : action === 'defer'
      ? 'deferred'
      : action === 'dismiss' || action === 'reject'
        ? 'dismissed'
        : action
          ? 'answered'
          : null;
  const answer = typeof body.answer === 'string' ? body.answer
    : typeof body.message === 'string' ? body.message
      : typeof body.msg === 'string' ? body.msg
        : null;
  const answeredBy = typeof body.answered_by === 'string' ? body.answered_by
    : typeof body.answeredBy === 'string' ? body.answeredBy
      : typeof body.by === 'string' ? body.by
        : null;
  const existingMeta = parseJsonObject(existing.meta);
  const patchMeta = parseJsonObject(body.meta);
  const meta = Object.keys(patchMeta).length > 0 ? JSON.stringify({ ...existingMeta, ...patchMeta }) : null;

  queries.updateAsk(
    event.params.askId,
    status,
    typeof body.assigned_to === 'string' ? body.assigned_to : typeof body.assignedTo === 'string' ? body.assignedTo : null,
    body.owner_kind || body.ownerKind ? normalizeAskOwnerKind(body.owner_kind ?? body.ownerKind, existing.owner_kind) : null,
    body.priority ? normalizeAskPriority(body.priority, existing.priority) : null,
    answer,
    action,
    answeredBy,
    meta,
  );

  const ask = publicAsk(queries.getAsk(event.params.askId));
  const sourceMetaUpdate = syncSourceMessage(ask);
  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcast(event.params.id, { type: 'ask_updated', sessionId: event.params.id, ask });
  broadcastGlobal({ type: 'ask_updated', sessionId: event.params.id, ask });
  if (sourceMetaUpdate) {
    broadcast(sourceMetaUpdate.sessionId, {
      type: 'message_updated',
      sessionId: sourceMetaUpdate.sessionId,
      msgId: sourceMetaUpdate.msgId,
      meta: sourceMetaUpdate.meta,
    });
  }

  return json({ ask });
}

export async function DELETE(event: RequestEvent<{ id: string; askId: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const existing = getScopedAsk(event.params);
  if (!existing) return json({ error: 'not found' }, { status: 404 });

  queries.updateAsk(event.params.askId, 'dismissed', null, null, null, null, 'dismiss', null, null);
  const ask = publicAsk(queries.getAsk(event.params.askId));
  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcast(event.params.id, { type: 'ask_updated', sessionId: event.params.id, ask });
  broadcastGlobal({ type: 'ask_updated', sessionId: event.params.id, ask });

  return json({ ask });
}
