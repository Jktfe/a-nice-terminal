import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { toSafeMemoryFtsQuery } from '$lib/server/memory-search.js';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

export async function GET(event: RequestEvent) {
  assertNotRoomScoped(event);
  const { url } = event;
  const q = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const scope = url.searchParams.get('scope') || (url.searchParams.get('include_archives') === '1' ? 'all' : 'operational');

  if (q) {
    const ftsQuery = toSafeMemoryFtsQuery(q);
    if (!ftsQuery) return json({ memories: [], scope });

    const results = scope === 'all'
      ? queries.searchMemories(ftsQuery, limit)
      : scope === 'archive'
        ? queries.searchArchiveMemories(ftsQuery, limit)
        : queries.searchOperationalMemories(ftsQuery, limit);
    return json({ memories: results, scope });
  }

  const memories = scope === 'all'
    ? queries.listMemories(limit)
    : scope === 'archive'
      ? queries.listArchiveMemories(limit)
      : queries.listOperationalMemories(limit);
  return json({ memories, scope });
}

export async function POST(event: RequestEvent) {
  assertNotRoomScoped(event);
  const { request } = event;
  const body = await request.json();
  const { key, value, tags = [], session_id = null, created_by = null } = body;

  const cleanKey = typeof key === 'string' ? key.trim() : '';
  const cleanValue = typeof value === 'string'
    ? value.trim()
    : value == null
      ? ''
      : JSON.stringify(value);

  if (!cleanKey || !cleanValue) {
    return json({ ok: false, error: 'key and value are required' }, { status: 400 });
  }

  const tagValue = typeof tags === 'string' ? tags : JSON.stringify(Array.isArray(tags) ? tags : []);
  queries.upsertMemoryByKey(cleanKey, cleanValue, tagValue, session_id, created_by);
  const memory = queries.getMemoryByKey(cleanKey);
  return json({ ok: true, memory }, { status: 201 });
}

export async function DELETE(event: RequestEvent) {
  assertNotRoomScoped(event);
  const { url } = event;
  const id = url.searchParams.get('id');
  if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
  queries.deleteMemory(id);
  return json({ ok: true });
}
