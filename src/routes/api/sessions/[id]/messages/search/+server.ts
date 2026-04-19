import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const q = url.searchParams.get('q')?.trim();
  if (!q) return json({ results: [] });

  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const session = queries.getSession(params.id);
  if (!session) return json({ results: [], error: 'Session not found' }, { status: 404 });

  try {
    const results = queries.searchSessionMessages(params.id, q, limit);
    return json({ results });
  } catch {
    return json({ results: [], error: 'Invalid search query' }, { status: 400 });
  }
}
