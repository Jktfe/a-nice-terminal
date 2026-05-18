import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { ptyClient } from '$lib/server/pty-client.js';
import { queries } from '$lib/server/db.js';
import { capturePromptInput } from '$lib/server/prompt-capture.js';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

export async function POST(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const { params, request } = event;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const { data } = body;
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
  const promptEvent = capturePromptInput(params.id, data, {
    captureSource: 'api_terminal_input',
    transport: 'rest',
  });
  return json({ ok: true, event: promptEvent });
}
