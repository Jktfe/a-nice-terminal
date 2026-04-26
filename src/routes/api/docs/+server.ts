// ANT — Shared Research Docs API
// Agents co-author markdown documents, sign off, and present to users.
// Built on top of the memories key-value store with docs/ prefix.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

const DOC_PREFIX = 'docs/';

/** List all shared docs */
export function GET() {
  const rows = queries.listMemoriesByPrefix(DOC_PREFIX, 100) as any[];
  // Filter to root doc entries (not sections)
  const docs = rows
    .filter((r: any) => {
      const key = r.key?.replace(DOC_PREFIX, '') || '';
      return !key.includes('/'); // root doc, not a section
    })
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
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  return json({ docs });
}

/** Create a new shared doc */
export async function POST({ request }: RequestEvent) {
  const body = await request.json();
  const { id, title, description, author } = body;
  if (!id || !title) return json({ error: 'id and title required' }, { status: 400 });

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

  queries.upsertMemoryByKey(key, value, 'doc', null, author || null);
  return json({ key, id, title, status: 'draft' }, { status: 201 });
}
