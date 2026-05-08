import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listRoomArtefacts } from '$lib/server/room-artefacts.js';
import { assertSameRoom } from '$lib/server/room-scope.js';

export function GET(event: RequestEvent<{ id: string }>) {
  const summary = listRoomArtefacts(event.params.id);
  if (!summary) throw error(404, 'Session not found');
  assertSameRoom(event, summary.room_id);
  return json(summary);
}
