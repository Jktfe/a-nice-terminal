import { json } from '@sveltejs/kit';
import { ptyManager } from '$lib/server/pty-manager.js';

export async function POST({ params, request }) {
  const { data } = await request.json();
  if (!data || typeof data !== 'string') {
    return json({ ok: false, error: 'data must be a non-empty string' }, { status: 400 });
  }
  const ok = ptyManager.write(params.id, data);
  return json({ ok });
}
