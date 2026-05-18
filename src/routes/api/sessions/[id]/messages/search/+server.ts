import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertSameRoom } from '$lib/server/room-scope';

function normalizeLimit(raw: string | null) {
  const parsed = Number.parseInt(raw || '50', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

export function GET(event: RequestEvent<{ id: string }>) {
  const { params, url } = event;
  assertSameRoom(event, params.id);
  const session = queries.getSession(params.id);
  if (!session) return json({ results: [], error: 'Session not found' }, { status: 404 });
  if (session.archived || session.deleted_at) {
    return json({ results: [], error: 'Session is inactive' }, { status: 410 });
  }

  const q = url.searchParams.get('q')?.trim();
  if (!q) return json({ results: [] });

  const limit = normalizeLimit(url.searchParams.get('limit'));

  try {
    const results = queries.searchSessionMessages(params.id, q, limit);
    return json({ results });
  } catch {
    return json({ results: [], error: 'Invalid search query' }, { status: 400 });
  }
}
