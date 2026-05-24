/**
 * GET /api/chat-rooms/plan-progress
 *
 * Returns aggregate plan completion for every room that has attached plans.
 * Used by /rooms to show compact progress bars on room cards.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';
import { resolveChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ request }) => {
  const access = await resolveChatRoomReadAccess(request);
  if (!access) throw error(401, 'Authentication required.');

  const db = getIdentityDb();

  // Aggregate tasks across all plans attached to each room.
  // JOIN plan_rooms → tasks, group by room_id.
  const rows = db
    .prepare(
      `SELECT
         pr.room_id,
         COUNT(t.id) AS total,
         SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM plan_rooms pr
       LEFT JOIN tasks t ON t.plan_id = pr.plan_id AND t.status != 'deleted'
       GROUP BY pr.room_id`
    )
    .all() as { room_id: string; total: number; completed: number }[];

  const progress: Record<string, { total: number; completed: number; pct: number }> = {};
  for (const row of rows) {
    const total = row.total ?? 0;
    const completed = row.completed ?? 0;
    progress[row.room_id] = {
      total,
      completed,
      pct: total === 0 ? 0 : completed / total
    };
  }

  return json({ progress });
};
