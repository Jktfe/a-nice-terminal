/**
 * /api/tasks — Lane-D PLANS S1 + JWPK TASKS-SUBSYSTEM (2026-05-16).
 *
 * GET  → list tasks. Two shapes:
 *        - legacy (?includeDeleted=1): returns Lane-D taskStore rows.
 *        - JWPK   (?status=&assigned=&terminal=&room=): returns
 *          tasksStore (JWPK) rows. Any JWPK query param triggers JWPK
 *          mode; with neither query param, returns the legacy list.
 * POST → create a task. Two body shapes:
 *        - legacy (Lane-D): { id, subject, description?, status?,
 *          priority?, planId?, assignedAgent?, evidence?, notes?,
 *          startedAtMs?, endedAtMs? }.
 *        - JWPK: { title, description?, assigned_to?,
 *          assigned_terminal_id?, room_id?, parent_task_id? }.
 *        Shape selected by presence of `title` (JWPK) vs `subject`
 *        (legacy). plan_id is OPTIONAL (JWPK Q1: a task is first-class,
 *        never a child of a plan).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createTask, getTask, listTasks, isTaskStatus } from '$lib/server/taskStore';
import {
  createTask as createJwpkTask,
  listTasks as listJwpkTasks,
  isJwpkTaskStatus,
  type ListJwpkTasksFilter
} from '$lib/server/tasksStore';
import { dispatchPlanEvent } from '$lib/server/planTriggerDispatcher';
import { requireChatRoomMutationAuth, tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

const JWPK_QUERY_KEYS = ['status', 'assigned', 'terminal', 'room'];

function hasAnyJwpkQuery(url: URL): boolean {
  return JWPK_QUERY_KEYS.some((k) => url.searchParams.has(k));
}

function requireAdminBearer(request: Request): void {
  if (!tryAdminBearer(request)) throw error(401, 'Authentication required.');
}

export const GET: RequestHandler = async ({ request, url }) => {
  if (hasAnyJwpkQuery(url)) {
    const filter: ListJwpkTasksFilter = {};
    const status = url.searchParams.get('status');
    if (status !== null) {
      if (!isJwpkTaskStatus(status)) {
        throw error(400, 'status must be one of todo|in_progress|done|cancelled|blocked.');
      }
      filter.status = status;
    }
    const assigned = url.searchParams.get('assigned');
    if (assigned !== null) filter.assignedTo = assigned;
    const terminal = url.searchParams.get('terminal');
    if (terminal !== null) filter.assignedTerminalId = terminal;
    const room = url.searchParams.get('room');
    if (room !== null) {
      const roomEntity = findChatRoomById(room);
      if (!roomEntity) throw error(404, 'Room not found.');
      await requireChatRoomReadAccess(request, roomEntity);
      filter.roomId = room;
    } else {
      requireAdminBearer(request);
    }
    return json({ tasks: listJwpkTasks(filter) });
  }
  requireAdminBearer(request);
  const includeDeleted = url.searchParams.get('includeDeleted') === '1';
  return json({ tasks: listTasks({ includeDeleted }) });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;
  const roomId =
    typeof b.room_id === 'string'
      ? b.room_id
      : (typeof b.roomId === 'string' ? b.roomId : null);
  if (roomId !== null) {
    if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
    requireChatRoomMutationAuth(roomId, request, b);
  } else {
    requireAdminBearer(request);
  }

  // JWPK shape: `title` present (no `subject`) → use the new tasksStore.
  if (typeof b.title === 'string' && typeof b.subject !== 'string') {
    if (b.title.trim().length === 0) throw error(400, 'title is required.');
    if (b.status !== undefined && !isJwpkTaskStatus(b.status)) {
      throw error(400, 'status must be one of todo|in_progress|done|cancelled|blocked.');
    }
    const created = createJwpkTask({
      title: b.title,
      description: typeof b.description === 'string' ? b.description : '',
      status: isJwpkTaskStatus(b.status) ? b.status : undefined,
      assignedTo: typeof b.assigned_to === 'string' ? b.assigned_to : null,
      assignedTerminalId:
        typeof b.assigned_terminal_id === 'string' ? b.assigned_terminal_id : null,
      roomId,
      planId:
        typeof b.plan_id === 'string'
          ? b.plan_id
          : (typeof b.planId === 'string' ? b.planId : null),
      parentTaskId: typeof b.parent_task_id === 'string' ? b.parent_task_id : null,
      createdBy: typeof b.created_by === 'string' ? b.created_by : null,
      orderIndex: typeof b.order_index === 'number' ? b.order_index : 0
    });
    return json({ task: created }, { status: 201 });
  }
  if (typeof b.id !== 'string' || b.id.trim().length === 0) {
    throw error(400, 'id is required.');
  }
  if (typeof b.subject !== 'string' || b.subject.trim().length === 0) {
    throw error(400, 'subject is required.');
  }
  if (b.status !== undefined && !isTaskStatus(b.status)) {
    throw error(400, 'status must be one of pending|in_progress|blocked|completed|deleted.');
  }
  if (b.priority !== undefined && b.priority !== null && typeof b.priority !== 'number') {
    throw error(400, 'priority must be a number or null.');
  }
  if (getTask(b.id)) throw error(409, 'A task with this id already exists.');

  const created = createTask({
    id: b.id,
    subject: b.subject,
    description: typeof b.description === 'string' ? b.description : null,
    status: isTaskStatus(b.status) ? b.status : undefined,
    priority: typeof b.priority === 'number' ? b.priority : null,
    planId: typeof b.planId === 'string' ? b.planId : null,
    assignedAgent: typeof b.assignedAgent === 'string' ? b.assignedAgent : null,
    evidence: Array.isArray(b.evidence) ? (b.evidence as never[]) : null,
    notes: typeof b.notes === 'string' ? b.notes : null,
    startedAtMs: typeof b.startedAtMs === 'number' ? b.startedAtMs : null,
    endedAtMs: typeof b.endedAtMs === 'number' ? b.endedAtMs : null
  });
  // ANTSCRIPT task.created — wildcard triggers (planId NULL) fire even
  // for standalone tasks. Recursion-safe: a task.create action that
  // generates a follow-up task will itself emit task.created, but the
  // synthetic `auto_…` id prefix + plain-action-config matching gives
  // operators control over loop prevention via planId targeting.
  dispatchPlanEvent('task.created', {
    planId: created.planId,
    task: {
      id: created.id,
      subject: created.subject,
      status: created.status,
      assignedAgent: created.assignedAgent
    }
  });
  return json({ task: created }, { status: 201 });
};
