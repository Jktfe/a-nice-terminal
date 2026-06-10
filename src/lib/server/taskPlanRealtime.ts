/**
 * taskPlanRealtime — fans task/plan mutations into the per-room SSE bus so
 * the /rooms/[roomId] Tasks & Plans panels refresh live, not only when an
 * incidental chat message happens to land in the room.
 *
 * The realtime bus (eventBroadcast) is keyed by roomId, but tasks/plans are
 * plan-keyed (tasks.plan_id) or room-keyed (standalone tasks.room_id). The
 * bridge mirrors listTasksForRoom's membership rule IN REVERSE: a task
 * surfaces in room R iff its plan is attached to R (plan_rooms) OR it is
 * standalone (plan_id IS NULL) with room_id = R. A plan surfaces in every
 * room it's attached to (listRoomsForPlan).
 *
 * Emitted event types — consumed today by the client's invalidateAll()-on-
 * any-event listener (so the exact type doesn't change web behaviour yet),
 * but typed so the native antOS app can discriminate task vs plan vs message:
 *   { type: 'task_changed', action, taskId, planId, status? }
 *   { type: 'plan_changed', action, planId }
 *
 * These are best-effort UI hints, never a source of truth: a dropped event
 * just means a panel is stale until the next event or a manual reload. So
 * callers should treat a broadcast failure as non-fatal (it never throws on
 * a missing subscriber — broadcastToRoom is a no-op when nobody's listening).
 */
import { broadcastToRoom } from './eventBroadcast';
import { getIdentityDb } from './db';
import { listRoomsForPlan } from './planRoomLinkStore';

export type TaskChangeAction = 'created' | 'updated' | 'deleted';
export type PlanChangeAction =
  | 'created'
  | 'updated'
  | 'archived'
  | 'restored'
  | 'deleted'
  | 'attached'
  | 'detached';

/**
 * Rooms whose /tasks feed includes this task — the exact reverse of
 * listTasksForRoom. Reads the live `tasks` row, so call it while the row
 * still exists: a soft-delete keeps the row (status='deleted') so this still
 * resolves, but a hard cascade-delete removes it — snapshot rooms first in
 * that case. Returns [] for an unknown task or a standalone task with no room.
 */
export function roomIdsForTask(taskId: string): string[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT pr.room_id AS room_id
         FROM tasks t JOIN plan_rooms pr ON pr.plan_id = t.plan_id
        WHERE t.id = ?
       UNION
       SELECT t.room_id AS room_id
         FROM tasks t
        WHERE t.id = ? AND t.plan_id IS NULL AND t.room_id IS NOT NULL`
    )
    .all(taskId, taskId) as { room_id: string }[];
  return rows.map((r) => r.room_id);
}

/**
 * Broadcast a task_changed event to every room whose Tasks panel shows this
 * task. Returns the rooms notified (empty = no room hosts it, a no-op).
 */
export function broadcastTaskChanged(
  taskId: string,
  detail: { action: TaskChangeAction; planId?: string | null; status?: string | null }
): string[] {
  // Best-effort UI hint: the mutation has already committed by the time we're
  // called, so a broadcast failure (e.g. a transient DB error in
  // roomIdsForTask) must NOT propagate and turn the write's 200/201 into a
  // 500. Swallow + log rather than throw — observable, never fatal.
  try {
    const rooms = roomIdsForTask(taskId);
    for (const roomId of rooms) {
      broadcastToRoom(roomId, {
        type: 'task_changed',
        action: detail.action,
        taskId,
        planId: detail.planId ?? null,
        ...(detail.status != null ? { status: detail.status } : {})
      });
    }
    return rooms;
  } catch (err) {
    console.warn(`[taskPlanRealtime] task_changed broadcast failed for ${taskId}:`, err);
    return [];
  }
}

/**
 * Broadcast a plan_changed event to every room hosting the plan. Pass
 * extraRoomIds for rooms that won't (or no longer) appear in listRoomsForPlan
 * but still need to refresh — e.g. the just-detached room, or rooms
 * snapshotted before a cascade hard-delete tears down their plan_rooms links.
 * Returns the de-duplicated rooms notified.
 */
export function broadcastPlanChanged(
  planId: string,
  detail: { action: PlanChangeAction },
  extraRoomIds: string[] = []
): string[] {
  // Best-effort UI hint — see broadcastTaskChanged: never let a broadcast
  // failure roll back the already-committed plan mutation's response.
  try {
    const rooms = new Set<string>(listRoomsForPlan(planId).map((r) => r.roomId));
    for (const roomId of extraRoomIds) rooms.add(roomId);
    for (const roomId of rooms) {
      broadcastToRoom(roomId, { type: 'plan_changed', action: detail.action, planId });
    }
    return [...rooms];
  } catch (err) {
    console.warn(`[taskPlanRealtime] plan_changed broadcast failed for ${planId}:`, err);
    return [];
  }
}
