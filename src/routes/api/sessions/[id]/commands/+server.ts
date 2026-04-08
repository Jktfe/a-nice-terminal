import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const commands = queries.getCommands(params.id, limit);
  return json(commands);
}
