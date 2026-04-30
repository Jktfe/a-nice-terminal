import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const id = item.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function PATCH({ request }: RequestEvent) {
  const body = await request.json().catch(() => ({}));
  const { broadcast } = await import('$lib/server/ws-broadcast.js');

  if (body?.reset === true) {
    queries.resetSessionOrder();
    broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });
    return json({ ok: true, reset: true });
  }

  const ids = uniqueStrings(body?.ids ?? body?.orderedIds);
  if (ids.length === 0) {
    return json({ error: 'ids must be a non-empty array of session ids' }, { status: 400 });
  }

  const activeSessions = queries.listSessions() as Array<{ id: string }>;
  const activeIds = new Set(activeSessions.map((session) => session.id));
  const invalidIds = ids.filter((id) => !activeIds.has(id));
  if (invalidIds.length > 0) {
    return json({ error: 'Cannot order archived, deleted, or unknown sessions', invalidIds }, { status: 400 });
  }

  const provided = new Set(ids);
  const completeOrder = [
    ...ids,
    ...activeSessions.map((session) => session.id).filter((id) => !provided.has(id)),
  ];
  queries.reorderSessions(completeOrder);
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });
  return json({ ok: true, ids: completeOrder });
}
