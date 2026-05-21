import type Database from 'better-sqlite3';

type DatabaseLike = ReturnType<typeof Database>;

export type AutoRoomPlanSweepResult = {
  softDeleted: number;
  detached: number;
};

/**
 * Removes the generated, empty room-scoped plans created by the old
 * /api/chat-rooms/:roomId/plans read side effect.
 *
 * Guardrails:
 * - only ids shaped as room-<roomId> and linked back to that same room
 * - only default titles from the generator, including the legacy --name case
 * - only rows with no non-deleted tasks
 *
 * This preserves explicit plans, task-bearing plans, and arbitrary zero-task
 * plans that are not the generated room default shape.
 */
export function sweepAutoCreatedRoomPlansInDb(
  db: DatabaseLike,
  nowMs = Date.now()
): AutoRoomPlanSweepResult {
  const txn = db.transaction(() => {
    const candidates = db.prepare(
      `SELECT p.id
         FROM plans p
         JOIN plan_rooms pr ON pr.plan_id = p.id
         JOIN chat_rooms r ON r.id = pr.room_id
        WHERE p.id = 'room-' || pr.room_id
          AND p.deleted_at_ms IS NULL
          AND p.description IS NULL
          AND p.created_by IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM tasks t
             WHERE t.plan_id = p.id
               AND t.status != 'deleted'
          )
          AND (
            p.title = r.name || ' plan'
            OR p.title LIKE '--name % plan'
          )`
    ).all() as { id: string }[];

    if (candidates.length === 0) return { softDeleted: 0, detached: 0 };

    const softDelete = db.prepare(
      `UPDATE plans
          SET deleted_at_ms = ?, updated_at_ms = ?
        WHERE id = ?
          AND deleted_at_ms IS NULL`
    );
    const detach = db.prepare(`DELETE FROM plan_rooms WHERE plan_id = ?`);

    let softDeleted = 0;
    let detached = 0;
    for (const candidate of candidates) {
      detached += detach.run(candidate.id).changes;
      softDeleted += softDelete.run(nowMs, nowMs, candidate.id).changes;
    }
    return { softDeleted, detached };
  });

  return txn() as AutoRoomPlanSweepResult;
}
