import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { getTrackerView } from '$lib/server/trackerStore';

export const GET: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);
  const view = getTrackerView(params.trackerId);
  if (!view || view.roomId !== params.roomId) throw error(404, 'Tracker not found.');
  return json({ tracker: view });
};
