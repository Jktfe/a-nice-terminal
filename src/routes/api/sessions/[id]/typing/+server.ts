import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { broadcast } from '$lib/server/ws-broadcast';

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  if (!handle) return json({ error: 'handle is required' }, { status: 400 });
  if (typeof body?.typing !== 'boolean') {
    return json({ error: 'typing must be boolean' }, { status: 400 });
  }

  broadcast(params.id, { type: 'typing', handle, typing: body.typing });
  return json({ ok: true });
}
