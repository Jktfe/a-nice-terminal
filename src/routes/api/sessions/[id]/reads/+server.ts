import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

// GET /api/sessions/:id/reads — get all read receipts for a chat session
// Returns a map of message_id → [{ session_id, reader_name, reader_handle, read_at }]
export function GET({ params }: RequestEvent<{ id: string }>) {
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
