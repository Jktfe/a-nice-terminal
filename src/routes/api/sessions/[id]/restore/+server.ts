import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries, ttlMs } from '$lib/server/db';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';

export async function POST({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  // Allow restore for both soft-deleted (deleted_at set) and archived-only (archived=1) sessions
  if (!session.deleted_at && !session.archived) throw error(400, 'Session is not deleted or archived');

  // Check TTL window for soft-deleted sessions
  if (session.deleted_at && session.ttl !== 'forever') {
    const deletedAt = new Date(session.deleted_at).getTime();
    if ((Date.now() - deletedAt) >= ttlMs(session.ttl)) {
      throw error(410, 'Recovery window has expired');
    }
  }

  queries.restoreSession(params.id);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });
  return json(queries.getSession(params.id));
}
