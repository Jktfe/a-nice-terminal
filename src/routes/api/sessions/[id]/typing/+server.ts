import { json } from '@sveltejs/kit';
import { broadcast } from '$lib/server/ws-broadcast';

export async function POST({ params, request }) {
  const { handle, typing } = await request.json();
  broadcast(params.id, { type: 'typing', handle, typing });
  return json({ ok: true });
}
