/**
 * planRoomLinkStore — many-to-many link between plans and chat rooms.
 *
 * Plans aren't first-class entities (JWPK Q1, Lane-D): a "plan" exists
 * implicitly as any `plan_id` referenced elsewhere (today: tasks.plan_id,
 * the in-memory planModeStore event log, and now plan_rooms). The
 * junction `plan_rooms` is the first persistent place a plan_id can live
 * without a task — i.e. attaching a plan to a room creates the plan
 * implicitly. Same pattern as tasks: write a row, the plan "exists."
 *
 * Bidirectional reads:
 *   - listRoomsForPlan(planId)  → which rooms host this plan?
 *   - listPlansForRoom(roomId)  → which plans does this room host?
 *
 * No FK on plan_id (no plans table). FK on room_id with ON DELETE CASCADE
 * means deleting a room evaporates its attachments. PRAGMA foreign_keys
 * is ON in db.ts so the cascade actually fires.
 */

import { getIdentityDb } from './db';
import { sweepAutoCreatedRoomPlansInDb, type AutoRoomPlanSweepResult } from './autoRoomPlanCleanup';
import { ensurePlanRow } from './planStore';
import { planCompletion, type PlanCompletion } from './taskStore';

export type PlanRoomLink = {
  planId: string;
  roomId: string;
  attachedAtMs: number;
  attachedBy: string | null;
};

/** A room with its attachment metadata for a given plan. */
export type RoomForPlan = {
  roomId: string;
  name: string;
  attachedAtMs: number;
  attachedBy: string | null;
};

/** A plan attached to a given room, with live donut rollup. */
export type PlanForRoom = {
  planId: string;
  attachedAtMs: number;
  attachedBy: string | null;
  /** Live completion donut rollup — same shape /plans uses, computed at read time. */
  completion: PlanCompletion;
};

type RawLinkRow = {
  plan_id: string;
  room_id: string;
  attached_at_ms: number;
  attached_by: string | null;
};

/**
 * Idempotent attach. Returns {attached: false, alreadyAttached: true} if
 * the link already exists — the UI can re-click without special-casing.
 * Throws if the room doesn't exist (clearer 404 than letting the FK
 * raise a generic constraint error).
 */
export function attachPlanToRoom(input: {
  planId: string;
  roomId: string;
  attachedBy?: string | null;
}): { attached: boolean; alreadyAttached: boolean } {
  const db = getIdentityDb();
  const roomExists = db
    .prepare(`SELECT 1 FROM chat_rooms WHERE id = ?`)
    .get(input.roomId);
  if (!roomExists) {
    throw new PlanRoomLinkError(`Room ${input.roomId} not found.`, 'room_not_found');
  }
  const existing = db
    .prepare(`SELECT 1 FROM plan_rooms WHERE plan_id = ? AND room_id = ?`)
    .get(input.planId, input.roomId);
  if (existing) return { attached: false, alreadyAttached: true };
  db.prepare(
    `INSERT INTO plan_rooms (plan_id, room_id, attached_at_ms, attached_by)
     VALUES (?, ?, ?, ?)`
  ).run(input.planId, input.roomId, Date.now(), input.attachedBy ?? null);
  return { attached: true, alreadyAttached: false };
}

/** Idempotent detach. Returns {removed: false} if no such link existed. */
export function detachPlanFromRoom(input: {
  planId: string;
  roomId: string;
}): { removed: boolean } {
  const result = getIdentityDb()
    .prepare(`DELETE FROM plan_rooms WHERE plan_id = ? AND room_id = ?`)
    .run(input.planId, input.roomId);
  return { removed: result.changes > 0 };
}

/** "Which rooms host this plan?" — JOIN to chat_rooms for room.name. */
export function listRoomsForPlan(planId: string): RoomForPlan[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT pr.room_id, pr.attached_at_ms, pr.attached_by, r.name
         FROM plan_rooms pr
         JOIN chat_rooms r ON r.id = pr.room_id
        WHERE pr.plan_id = ?
        ORDER BY pr.attached_at_ms ASC, r.name ASC`
    )
    .all(planId) as {
    room_id: string;
    attached_at_ms: number;
    attached_by: string | null;
    name: string;
  }[];
  return rows.map((r) => ({
    roomId: r.room_id,
    name: r.name,
    attachedAtMs: r.attached_at_ms,
    attachedBy: r.attached_by
  }));
}

/**
 * "Which plans does this room host?" — each with a live completion rollup
 * so a future /rooms/[roomId] panel can show donuts without a round-trip
 * per plan. Computed at read time; no caching.
 */
export function listPlansForRoom(roomId: string): PlanForRoom[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT plan_id, attached_at_ms, attached_by
         FROM plan_rooms
        WHERE room_id = ?
        ORDER BY attached_at_ms ASC`
    )
    .all(roomId) as RawLinkRow[];
  return rows.map((r) => ({
    planId: r.plan_id,
    attachedAtMs: r.attached_at_ms,
    attachedBy: r.attached_by,
    completion: planCompletion(r.plan_id)
  }));
}

export function ensureDefaultPlanForRoom(input: {
  roomId: string;
  roomName: string;
  createdBy?: string | null;
}): PlanForRoom {
  const existing = listPlansForRoom(input.roomId);
  if (existing.length > 0) return existing[0];

  const planId = `room-${input.roomId}`;
  ensurePlanRow(planId, { title: `${input.roomName} plan` });
  attachPlanToRoom({
    planId,
    roomId: input.roomId,
    attachedBy: input.createdBy ?? null
  });
  const seeded = listPlansForRoom(input.roomId).find((plan) => plan.planId === planId);
  if (!seeded) throw new Error(`Default plan ${planId} was not attached to room ${input.roomId}.`);
  return seeded;
}

export function sweepAutoCreatedRoomPlans(nowMs?: number): AutoRoomPlanSweepResult {
  return sweepAutoCreatedRoomPlansInDb(getIdentityDb(), nowMs);
}

export class PlanRoomLinkError extends Error {
  reason: 'room_not_found';
  constructor(message: string, reason: 'room_not_found') {
    super(message);
    this.name = 'PlanRoomLinkError';
    this.reason = reason;
  }
}

/** Test helper — wipes the junction. Other tests reset their own state. */
export function _resetPlanRoomLinksForTests(): void {
  getIdentityDb().prepare(`DELETE FROM plan_rooms`).run();
}
