import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { listRoomArtefacts } from '$lib/server/room-artefacts.js';
import { assertSameRoom } from '$lib/server/room-scope.js';

function assertActiveSession(sessionId: string) {
  const session = queries.getSession(sessionId);
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
}

export function GET(event: RequestEvent<{ id: string }>) {
  const summary = listRoomArtefacts(event.params.id);
  if (!summary) throw error(404, 'Session not found');
  assertSameRoom(event, summary.room_id);
  assertActiveSession(summary.session_id);
  if (summary.room_id !== summary.session_id) assertActiveSession(summary.room_id);
  return json(summary);
}
