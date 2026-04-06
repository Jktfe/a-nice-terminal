import { json, error } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  return json(session);
}

export async function PATCH({ params, request }) {
  const body = await request.json();
  queries.updateSession(
    body.name || null,
    body.status || null,
    body.archived !== undefined ? (body.archived ? 1 : 0) : null,
    body.meta ? JSON.stringify(body.meta) : null,
    params.id
  );
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  return json(session);
}

export function DELETE({ params }) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  queries.deleteSession(params.id);
  return new Response(null, { status: 204 });
}
