import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

// GET /api/sessions/:id/status
// Returns the interactive-prompt state for a session.
// Primary consumer: iOS app polling for "needs input" badges.
export async function GET({ params }: RequestEvent<{ id: string }>) {
  const { getPendingEvent } = await import('$lib/server/agent-event-bus.js');
  const status = getPendingEvent(params.id);
  return json(status);
}
