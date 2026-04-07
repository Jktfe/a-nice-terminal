import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { ptyClient } from '$lib/server/pty-client.js';

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const { data } = await request.json();
  if (!data || typeof data !== 'string') {
    return json({ ok: false, error: 'data must be a non-empty string' }, { status: 400 });
  }
  ptyClient.write(params.id, data);
  return json({ ok: true });
}
