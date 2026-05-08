// ANT — Shared Research Docs API
// Agents co-author markdown documents, sign off, and present to users.
// Built on top of the memories key-value store with docs/ prefix.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite, assertSameRoom, roomScope } from '$lib/server/room-scope.js';

const DOC_PREFIX = 'docs/';

/** List all shared docs */
export function GET(event: RequestEvent) {
  const scope = roomScope(event);
  const requestedSessionId = event.url.searchParams.get('session_id')?.trim() || null;
  if (requestedSessionId) assertSameRoom(event, requestedSessionId);
  const filterRoomId = scope?.roomId ?? requestedSessionId;
  const rows = queries.listMemoriesByPrefix(DOC_PREFIX, 100) as any[];
  // Filter to root doc entries (not sections)
  const docs = rows
    .filter((r: any) => {
      const key = r.key?.replace(DOC_PREFIX, '') || '';
      return !key.includes('/'); // root doc, not a section
    })
    .filter((r: any) => !filterRoomId || r.session_id === filterRoomId)
    .map((r: any) => {
      let meta: any = {};
      try { meta = JSON.parse(r.value || '{}'); } catch { meta = { title: r.key }; }
      return {
        id: r.key?.replace(DOC_PREFIX, ''),
        key: r.key,
        title: meta.title || r.key,
        description: meta.description || '',
        status: meta.status || 'draft',
        authors: meta.authors || [],
        created_by: r.created_by,
        session_id: r.session_id ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  return json({ docs });
}

/** Create a new shared doc */
export async function POST(event: RequestEvent) {
  assertCanWrite(event);
  const { request } = event;
  const body = await request.json();
  const { id, title, description, author } = body;
  if (!id || !title) return json({ error: 'id and title required' }, { status: 400 });
  const scope = roomScope(event);
  const requestedSessionId = typeof body.session_id === 'string' && body.session_id.trim() ? body.session_id.trim() : null;
  if (requestedSessionId) assertSameRoom(event, requestedSessionId);
  const docSessionId = scope?.roomId ?? requestedSessionId;

  const key = DOC_PREFIX + id;
  const existing = queries.getMemoryByKey(key);
  if (existing) return json({ error: 'Doc already exists' }, { status: 409 });

  const value = JSON.stringify({
    title,
    description: description || '',
    status: 'draft',
    authors: author ? [author] : [],
    sections: [],
  });

  queries.upsertMemoryByKey(key, value, 'doc', docSessionId ?? null, author || null);
  return json({ key, id, title, status: 'draft' }, { status: 201 });
}
