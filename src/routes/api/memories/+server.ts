import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { randomUUID } from 'crypto';

export async function GET({ url }: RequestEvent) {
  const q = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  if (q) {
    const results = queries.searchMemories(q, limit);
    return json({ memories: results });
  }

  const memories = queries.listMemories(limit);
  return json({ memories });
}

export async function POST({ request }: RequestEvent) {
  const body = await request.json();
  const { key, value, tags = [], session_id = null, created_by = null } = body;

  if (!key?.trim() || !value?.trim()) {
    return json({ ok: false, error: 'key and value are required' }, { status: 400 });
  }

  const id = randomUUID();
  queries.upsertMemory(id, key.trim(), value.trim(), JSON.stringify(tags), session_id, created_by);
  const memory = queries.getMemory(id);
  return json({ ok: true, memory }, { status: 201 });
}

export async function DELETE({ url }: RequestEvent) {
  const id = url.searchParams.get('id');
  if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
  queries.deleteMemory(id);
  return json({ ok: true });
}
