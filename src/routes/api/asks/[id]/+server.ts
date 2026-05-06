import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import {
  normalizeAskAction,
  normalizeAskOwnerKind,
  normalizeAskPriority,
  normalizeAskStatus,
} from '$lib/server/ask-inference';
import { assertCanWrite, roomScope } from '$lib/server/room-scope';
import { emitAskRunEvent } from '$lib/server/ask-events';
import { injectAskResolution } from '$lib/server/ask-pty-bridge';

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

function assertAskVisibleToScope(event: RequestEvent, ask: any): Response | null {
  const scope = roomScope(event);
  if (!scope || scope.roomId === ask.session_id) return null;
  return json({ error: 'Room token does not authorise this room' }, { status: 403 });
}

export function GET(event: RequestEvent<{ id: string }>) {
  const ask = queries.getAsk(event.params.id);
  if (!ask) return json({ error: 'not found' }, { status: 404 });
  const scoped = assertAskVisibleToScope(event, ask);
  if (scoped) return scoped;
  return json({ ask: publicAsk(ask) });
}

export async function PATCH(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);
  const existing = queries.getAsk(event.params.id);
  if (!existing) return json({ error: 'not found' }, { status: 404 });
  const scoped = assertAskVisibleToScope(event, existing);
  if (scoped) return scoped;

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
  const meta = Object.keys(patchMeta).length > 0
    ? JSON.stringify({ ...existingMeta, ...patchMeta })
    : null;

  // Optional asks → terminal stdin bridge: when a target_session_id is provided
  // and the action is approve/reject/answer, inject the resolution into the
  // owning terminal's PTY. The text becomes part of the audit trail via
  // capturePromptInput. Failures are surfaced in the response but don't block
  // the ask status update.
  const targetSessionId = typeof body.target_session_id === 'string'
    ? body.target_session_id
    : typeof body.targetSessionId === 'string' ? body.targetSessionId : null;
  let bridge: ReturnType<typeof injectAskResolution> | null = null;
  if (targetSessionId && (action === 'approve' || action === 'reject' || action === 'answer')) {
    bridge = injectAskResolution({
      targetSessionId,
      action,
      answer,
      askId: event.params.id,
      roomId: existing.session_id,
    });
  }

  queries.updateAsk(
    event.params.id,
    status,
    typeof body.assigned_to === 'string' ? body.assigned_to : typeof body.assignedTo === 'string' ? body.assignedTo : null,
    body.owner_kind || body.ownerKind ? normalizeAskOwnerKind(body.owner_kind ?? body.ownerKind, existing.owner_kind) : null,
    body.priority ? normalizeAskPriority(body.priority, existing.priority) : null,
    answer,
    action,
    answeredBy,
    meta,
  );

  const ask = publicAsk(queries.getAsk(event.params.id));
  emitAskRunEvent('ask_updated', ask, {
    previousStatus: existing.status,
    action: action || null,
    bridge: bridge ? { ok: bridge.ok, reason: bridge.reason ?? null, injected: bridge.injected ?? null, cliFlag: bridge.cliFlag ?? null } : null,
  });

  let sourceMetaUpdate: { sessionId: string; msgId: string; meta: Record<string, unknown> } | null = null;
  if (existing.source_message_id) {
    try {
      const source = queries.getMessage(existing.source_message_id) as any;
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
      queries.updateMessageMeta(existing.source_message_id, JSON.stringify({
        ...sourceMeta,
        ask_id: ask.id,
        ask_status: ask.status,
        ask_answer_action: ask.answer_action ?? null,
      }));
      sourceMetaUpdate = {
        sessionId: source.session_id,
        msgId: existing.source_message_id,
        meta: {
          ...sourceMeta,
          ask_id: ask.id,
          ask_status: ask.status,
          ask_answer_action: ask.answer_action ?? null,
        },
      };
    } catch {}
  }

  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcast(ask.session_id, { type: 'ask_updated', sessionId: ask.session_id, ask });
  broadcastGlobal({ type: 'ask_updated', sessionId: ask.session_id, ask });
  if (sourceMetaUpdate) {
    broadcast(sourceMetaUpdate.sessionId, {
      type: 'message_updated',
      sessionId: sourceMetaUpdate.sessionId,
      msgId: sourceMetaUpdate.msgId,
      meta: sourceMetaUpdate.meta,
    });
  }

  return json({ ask, bridge });
}

export async function DELETE(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);
  const existing = queries.getAsk(event.params.id);
  if (!existing) return json({ error: 'not found' }, { status: 404 });
  const scoped = assertAskVisibleToScope(event, existing);
  if (scoped) return scoped;

  queries.updateAsk(event.params.id, 'dismissed', null, null, null, null, 'dismiss', null, null);
  const ask = publicAsk(queries.getAsk(event.params.id));
  emitAskRunEvent('ask_updated', ask, {
    previousStatus: existing.status,
    action: 'dismiss',
  });
  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcast(ask.session_id, { type: 'ask_updated', sessionId: ask.session_id, ask });
  broadcastGlobal({ type: 'ask_updated', sessionId: ask.session_id, ask });

  return json({ ask });
}
