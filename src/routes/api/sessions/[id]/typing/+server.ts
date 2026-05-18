import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';
import { broadcast } from '$lib/server/ws-broadcast';

export async function POST(event: RequestEvent<{ id: string }>) {
  const { params, request } = event;
  assertSameRoom(event, params.id);
  assertCanWrite(event);

  const session = queries.getSession(params.id) as Record<string, unknown> | undefined;
  if (!session) return json({ error: 'Session not found' }, { status: 404 });
  if (session.archived || session.deleted_at) {
    return json({ error: 'Session is inactive' }, { status: 410 });
  }

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
