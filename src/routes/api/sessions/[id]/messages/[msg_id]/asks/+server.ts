import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite } from '$lib/server/room-scope';

/** PATCH /api/sessions/:id/messages/:msg_id/asks — persist resolved indices into combined asks list. */
export async function PATCH(event: RequestEvent<{ id: string; msg_id: string }>) {
  assertCanWrite(event);
  const { params, request } = event;

  const body = await request.json().catch(() => null);
  const resolved = body?.resolved;
  if (!Array.isArray(resolved) || !resolved.every((n) => Number.isInteger(n) && n >= 0)) {
    return json({ error: 'resolved must be an array of non-negative integers' }, { status: 400 });
  }
  if (new Set(resolved).size !== resolved.length) {
    return json({ error: 'resolved indices must be unique' }, { status: 400 });
  }

  const existing: any = queries.getMessage(params.msg_id);
  if (!existing || existing.session_id !== params.id) {
    return json({ error: 'message not found' }, { status: 404 });
  }

  let meta: any = {};
  try { meta = JSON.parse(existing.meta || '{}'); } catch {}
  const explicit: string[] = Array.isArray(meta.asks) ? meta.asks : [];
  const inferred: string[] = Array.isArray(meta.inferred_asks) ? meta.inferred_asks : [];
  const total = explicit.length + inferred.length;
  if (resolved.some((n: number) => n >= total)) {
    return json({ error: 'resolved index out of range' }, { status: 400 });
  }

  meta.asks_resolved = resolved;
  const metaJson = JSON.stringify(meta);
  queries.updateMessageMeta(params.msg_id, metaJson);

  const updatedAsks: any[] = [];
  if (Array.isArray(meta.ask_ids)) {
    for (const index of resolved) {
      const askId = meta.ask_ids[index];
      if (typeof askId !== 'string') continue;
      queries.updateAsk(askId, 'answered', null, null, null, 'Resolved from pinned ask panel', 'answer', null, null);
      const ask = queries.getAsk(askId);
      if (ask) updatedAsks.push(ask);
    }
  }

  const updated = { ...existing, meta: metaJson };
  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'message_updated', sessionId: params.id, msgId: params.msg_id, meta });
  for (const ask of updatedAsks) {
    broadcast(params.id, { type: 'ask_updated', sessionId: params.id, ask });
    broadcastGlobal({ type: 'ask_updated', sessionId: params.id, ask });
  }

  return json({ ok: true, message: updated });
}
