import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';

function parseLimit(raw: string | null) {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 100;
  return Math.min(parsed, 500);
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id) as any;
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
  const limit = parseLimit(url.searchParams.get('limit'));
  const commands = queries.getCommands(params.id, limit);
  return json(commands);
}
