import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const refs = queries.listFileRefs(params.id);
  return json({ refs });
}

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
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

export async function DELETE({ params, url }: RequestEvent<{ id: string }>) {
  const refId = url.searchParams.get('refId');
  if (!refId) return json({ error: 'refId required' }, { status: 400 });

  const result = queries.deleteFileRefForSession(refId, params.id);
  if (result.changes === 0) return json({ error: 'file ref not found' }, { status: 404 });

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'file_ref_deleted', sessionId: params.id, refId });

  return json({ ok: true });
}
