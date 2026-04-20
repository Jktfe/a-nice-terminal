import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getPresence } from '$lib/server/ws-broadcast';

export async function GET({ params }: RequestEvent<{ sessionId: string }>) {
  const { sessionId } = params;
  const presence = getPresence(sessionId);
  return json({ presence });
}
