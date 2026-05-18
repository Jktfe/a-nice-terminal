import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { getPendingPrompt } from '$lib/server/prompt-bridge.js';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id) as any;
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
  if (session.type !== 'terminal') throw error(400, 'Prompt bridge is only available for terminal sessions');

  return json({
    pending: getPendingPrompt(params.id),
  });
}
