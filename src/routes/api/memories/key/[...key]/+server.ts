// ANT v3 — Key-addressed memory access
//
// GET    /api/memories/key/<key>          → latest row for this key
// PUT    /api/memories/key/<key>          → upsert row (value in body)
// DELETE /api/memories/key/<key>          → delete by key
//
// The key segment is declared as `[...key]` so it can contain slashes
// (`tasks/t-42`, `agents/haiku-local`, `done/2026-04-11/t-91`). The
// mempalace schema relies on slash-delimited keys for prefix scans.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

export function GET(event: RequestEvent<{ key: string }>) {
  assertNotRoomScoped(event);
  const { params } = event;
  const row = queries.getMemoryByKey(params.key);
  if (!row) throw error(404, `No memory at key: ${params.key}`);
  return json({ memory: row });
}

export async function PUT(event: RequestEvent<{ key: string }>) {
  assertNotRoomScoped(event);
  const { params, request } = event;
  const body = await request.json().catch(() => ({}));
  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value ?? body);
  if (!value) throw error(400, 'value is required');

  const tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);
  const sessionId = body.session_id ?? null;
  const createdBy = body.created_by ?? null;

  queries.upsertMemoryByKey(params.key, value, tags, sessionId, createdBy);
  const row = queries.getMemoryByKey(params.key);
  return json({ ok: true, memory: row });
}

export function DELETE(event: RequestEvent<{ key: string }>) {
  assertNotRoomScoped(event);
  const { params } = event;
  queries.deleteMemoryByKey(params.key);
  return new Response(null, { status: 204 });
}
