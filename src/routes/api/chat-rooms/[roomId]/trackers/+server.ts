import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { createTracker, listTrackersForRoom, type TrackerColumnType } from '$lib/server/trackerStore';
import { postTrackerCreateReceipt, parseColumnSpec } from '$lib/server/trackerRouteHelpers';

const VALID_TYPES = new Set<TrackerColumnType>(['text', 'number', 'currency', 'date', 'bool', 'link']);

export const GET: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);
  return json({ trackers: listTrackersForRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');
  const body = rawBody as Record<string, unknown>;
  // Any room member may create (resolveCallerIdentityStrict enforces membership).
  const createdByHandle = requireChatRoomMutationAuth(params.roomId, request, rawBody).handle;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length === 0) throw error(400, 'title (non-empty) is required.');

  // columns: either a structured array [{label,type}] or a `columnSpec` string
  // ("Beneficiary, Quantum(£), Paid(y/n)") from the /tracker grammar.
  let columns: Array<{ label: string; type?: TrackerColumnType }> = [];
  if (Array.isArray(body.columns)) {
    columns = body.columns
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        label: typeof c.label === 'string' ? c.label : '',
        type: typeof c.type === 'string' && VALID_TYPES.has(c.type as TrackerColumnType) ? (c.type as TrackerColumnType) : undefined
      }))
      .filter((c) => c.label.trim().length > 0);
  } else if (typeof body.columnSpec === 'string') {
    columns = parseColumnSpec(body.columnSpec);
  }
  if (columns.length === 0) throw error(400, 'At least one column is required.');

  const tracker = createTracker({ roomId: params.roomId, title, columns, createdByHandle });
  postTrackerCreateReceipt(params.roomId, tracker.id, tracker.title, createdByHandle);
  return json({ tracker }, { status: 201 });
};
