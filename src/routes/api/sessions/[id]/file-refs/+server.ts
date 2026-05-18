import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';
import { nanoid } from 'nanoid';

function assertActiveSession(id: string) {
  const session = queries.getSession(id);
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
  return session;
}

export function GET(event: RequestEvent<{ id: string }>) {
  const { params } = event;
  assertSameRoom(event, params.id);
  assertActiveSession(params.id);

  const refs = queries.listFileRefs(params.id);
  return json({ refs });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  const { params, request } = event;
  assertSameRoom(event, params.id);
  assertCanWrite(event);
  assertActiveSession(params.id);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const filePath = typeof body?.file_path === 'string' ? body.file_path.trim() : '';
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const flaggedBy = typeof body?.flagged_by === 'string' && body.flagged_by.trim()
    ? body.flagged_by.trim()
    : null;
  if (!filePath) return json({ error: 'file_path required' }, { status: 400 });

  const id = nanoid();
  queries.createFileRef(id, params.id, flaggedBy, filePath, note);

  const ref = { id, session_id: params.id, flagged_by: flaggedBy, file_path: filePath, note };

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'file_ref_created', sessionId: params.id, ref });

  return json({ ref }, { status: 201 });
}

export async function DELETE(event: RequestEvent<{ id: string }>) {
  const { params, url } = event;
  assertSameRoom(event, params.id);
  assertCanWrite(event);
  assertActiveSession(params.id);

  const refId = url.searchParams.get('refId');
  if (!refId) return json({ error: 'refId required' }, { status: 400 });

  const result = queries.deleteFileRefForSession(refId, params.id);
  if (result.changes === 0) return json({ error: 'file ref not found' }, { status: 404 });

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'file_ref_deleted', sessionId: params.id, refId });

  return json({ ok: true });
}
