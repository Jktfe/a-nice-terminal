import { json } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ url }) {
  const q = url.searchParams.get('q');
  if (!q) return json({ results: [] });

  const limit = parseInt(url.searchParams.get('limit') || '50');

  try {
    const results = queries.searchMessages(q, limit);
    return json({ results });
  } catch (e) {
    // FTS5 query syntax error
    return json({ results: [], error: 'Invalid search query' }, { status: 400 });
  }
}
