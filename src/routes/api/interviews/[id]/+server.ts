import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { assertSameRoom } from '$lib/server/room-scope.js';
import { loadInterviewBundle } from '$lib/server/interviews.js';

export function GET(event: RequestEvent<{ id: string }>) {
  const bundle = loadInterviewBundle(event.params.id);
  if (!bundle) return json({ error: 'interview not found' }, { status: 404 });
  assertSameRoom(event, bundle.interview.room_id);
  return json(bundle);
}
