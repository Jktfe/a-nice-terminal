import { json, error } from '@sveltejs/kit';
import { queries, ttlMs } from '$lib/server/db';

export function POST({ params }) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  if (!session.deleted_at) throw error(400, 'Session is not deleted');

  // Check TTL window hasn't expired
  if (session.ttl !== 'forever') {
    const deletedAt = new Date(session.deleted_at).getTime();
    if ((Date.now() - deletedAt) >= ttlMs(session.ttl)) {
      throw error(410, 'Recovery window has expired');
    }
  }

  queries.restoreSession(params.id);
  return json(queries.getSession(params.id));
}
