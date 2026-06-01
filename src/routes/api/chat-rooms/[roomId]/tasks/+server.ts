/**
 * GET /api/chat-rooms/:roomId/tasks — tasks-for-room feed.
 *
 * Returns tasks linked to plans attached to this room PLUS standalone
 * tasks (plan_id IS NULL). Excludes deleted tasks. Used by the room
 * page "Tasks" collapsible for read-only v3-parity (#54).
 *
 * 200 { tasks: TaskForRoom[] }
 * 400 missing roomId
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTasksForRoom } from '$lib/server/taskStore';

export const GET: RequestHandler = async ({ params }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId is required.');
  return json({ tasks: listTasksForRoom(roomId) });
};
