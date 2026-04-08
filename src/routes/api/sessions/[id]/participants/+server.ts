import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) return json({ error: 'not found' }, { status: 404 });

  const participants = queries.listParticipants(params.id);
  return json({ participants });
}
