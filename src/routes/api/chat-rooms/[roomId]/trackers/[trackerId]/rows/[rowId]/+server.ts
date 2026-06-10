import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { setCell, getTracker, getTrackerView } from '$lib/server/trackerStore';
import { postCellSetEvent } from '$lib/server/trackerRouteHelpers';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');
  const body = rawBody as Record<string, unknown>;
  const columnKey = typeof body.columnKey === 'string' ? body.columnKey : '';
  if (columnKey.length === 0) throw error(400, 'columnKey is required.');
  const value = body.value === null || body.value === undefined ? '' : String(body.value);
  const byHandle = requireChatRoomMutationAuth(params.roomId, request, rawBody).handle;
  const tracker = getTracker(params.trackerId);
  if (!tracker || tracker.roomId !== params.roomId) throw error(404, 'Tracker not found.');
  const column = tracker.columns.find((c) => c.key === columnKey);
  if (!column) throw error(400, `Unknown column: ${columnKey}`);

  // Capture the real old value so the audit chat-event carries true old→new,
  // and so a no-op write posts no event.
  const view = getTrackerView(params.trackerId);
  const existing = view?.rows.find((r) => r.id === params.rowId);
  if (!existing) throw error(404, 'Row not found.');
  const oldValue = existing.cells[columnKey] ?? '';

  const row = setCell({ tableId: params.trackerId, rowId: params.rowId, columnKey, value, byHandle });
  if (!row) throw error(404, 'Row or column not found.');
  if (oldValue !== value) {
    postCellSetEvent(params.roomId, tracker.title, column.label, oldValue, value, byHandle);
  }
  return json({ row });
};
