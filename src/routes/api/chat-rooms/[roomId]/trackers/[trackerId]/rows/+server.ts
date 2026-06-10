import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { addRow, getTracker } from '$lib/server/trackerStore';
import { postRowAddedEvent } from '$lib/server/trackerRouteHelpers';

export const POST: RequestHandler = async ({ params, request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');
  const body = rawBody as Record<string, unknown>;
  const byHandle = requireChatRoomMutationAuth(params.roomId, request, rawBody).handle;
  const tracker = getTracker(params.trackerId);
  if (!tracker || tracker.roomId !== params.roomId) throw error(404, 'Tracker not found.');
  const cells: Record<string, string> = {};
  if (body.cells && typeof body.cells === 'object') {
    for (const [k, v] of Object.entries(body.cells as Record<string, unknown>)) {
      cells[k] = v === null || v === undefined ? '' : String(v);
    }
  }
  const row = addRow({ tableId: params.trackerId, cells, byHandle });
  if (!row) throw error(404, 'Tracker not found.');
  postRowAddedEvent(params.roomId, tracker.title, byHandle);
  return json({ row }, { status: 201 });
};
