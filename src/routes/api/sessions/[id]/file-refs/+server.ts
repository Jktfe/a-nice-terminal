import { json } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET({ params }) {
  const refs = queries.listFileRefs(params.id);
  return json({ refs });
}

export async function POST({ params, request }) {
  const { file_path, note, flagged_by } = await request.json();
  if (!file_path) return json({ error: 'file_path required' }, { status: 400 });

  const id = nanoid();
  queries.createFileRef(id, params.id, flagged_by || null, file_path, note || null);

  const ref = { id, session_id: params.id, flagged_by: flagged_by || null, file_path, note: note || null };

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'file_ref_created', sessionId: params.id, ref });

  return json({ ref }, { status: 201 });
}

export async function DELETE({ params, url }) {
  const refId = url.searchParams.get('refId');
  if (!refId) return json({ error: 'refId required' }, { status: 400 });

  queries.deleteFileRef(refId);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'file_ref_deleted', sessionId: params.id, refId });

  return json({ ok: true });
}
