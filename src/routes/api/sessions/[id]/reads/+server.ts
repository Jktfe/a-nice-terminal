import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertSameRoom } from '$lib/server/room-scope';

// GET /api/sessions/:id/reads — get all read receipts for a chat session
// Returns a map of message_id → [{ session_id, reader_name, reader_handle, read_at }]
export function GET(event: RequestEvent<{ id: string }>) {
  const { params } = event;
  assertSameRoom(event, params.id);

  const session = queries.getSession(params.id) as any;
  if (!session) throw error(404, 'Session not found');
  if (session.archived || session.deleted_at) throw error(410, 'Session is inactive');
  if (session.type !== 'chat') throw error(400, 'Read receipts are only available for chat sessions');

  const rows = queries.getReadsForSession(params.id) as any[];

  // Group by message_id for efficient client-side consumption
  const byMessage: Record<string, any[]> = {};
  for (const row of rows) {
    if (!byMessage[row.message_id]) byMessage[row.message_id] = [];
    byMessage[row.message_id].push({
      session_id: row.session_id,
      reader_name: row.reader_name,
      reader_handle: row.reader_handle,
      read_at: row.read_at,
    });
  }

  return json({ reads: byMessage });
}
