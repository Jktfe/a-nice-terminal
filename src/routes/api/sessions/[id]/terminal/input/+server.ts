import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { ptyClient } from '$lib/server/pty-client.js';
import { queries } from '$lib/server/db.js';

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const { data } = await request.json();
  if (!data || typeof data !== 'string') {
    return json({ ok: false, error: 'data must be a non-empty string' }, { status: 400 });
  }
  const session = queries.getSession(params.id) as any;
  if (!session || session.type !== 'terminal') {
    return json({ ok: false, error: 'terminal session not found' }, { status: 404 });
  }
  if (session.deleted_at || session.archived) {
    return json({ ok: false, error: 'terminal session is inactive' }, { status: 410 });
  }
  ptyClient.write(params.id, data);
  return json({ ok: true });
}
