import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');

  return json({
    uploads: queries.listUploadsForSession(params.id),
  });
}
