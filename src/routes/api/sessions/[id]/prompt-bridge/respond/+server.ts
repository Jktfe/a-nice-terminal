import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { respondToPrompt } from '$lib/server/prompt-bridge.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';

export async function POST(event: RequestEvent<{ id: string }>) {
  const { params, request } = event;
  assertSameRoom(event, params.id);
  assertCanWrite(event);

  const session = queries.getSession(params.id) as any;
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
  if (session.type !== 'terminal') throw error(400, 'Prompt bridge is only available for terminal sessions');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const value = typeof body?.response === 'string' ? body.response : body?.text;
  if (typeof value !== 'string' || !value.trim()) {
    return json({ ok: false, error: 'text must be a non-empty string' }, { status: 400 });
  }

  const prompt = await respondToPrompt(params.id, value, { enter: body?.enter !== false });
  return json({ ok: true, prompt });
}
