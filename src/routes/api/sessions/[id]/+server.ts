import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  return json(session);
}

export async function PATCH({ params, request }: RequestEvent<{ id: string }>) {
  const body = await request.json();
  if (body.ttl) {
    queries.updateTtl(body.ttl, params.id);
  }
  if (body.name || body.status || body.archived !== undefined || body.meta) {
    queries.updateSession(
      body.name || null,
      body.status || null,
      body.archived !== undefined ? (body.archived ? 1 : 0) : null,
      body.meta ? JSON.stringify(body.meta) : null,
      params.id
    );
  }
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  return json(session);
}

// Soft-delete: marks deleted_at, PTY keeps running, recoverable within TTL window
export function DELETE({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  queries.softDeleteSession(params.id);
  return new Response(null, { status: 204 });
}
