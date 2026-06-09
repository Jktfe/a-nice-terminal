/**
 * /api/tasks/:taskId — Lane-D PLANS S1.
 *
 * GET    → one task (404 if missing).
 * PATCH  → partial update (subject/description/status/priority/planId/
 *          assignedAgent/evidence/notes/startedAtMs/endedAtMs). Dependency
 *          edges are NOT mutated here — use /dependencies.
 * DELETE → soft-delete (status='deleted'; SURFACE-SIZE-ONLY, never hard).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getTask,
  updateTask,
  deleteTask,
  isTaskStatus,
  normalizeWorkspaceIdentity,
  planCompletion
} from '$lib/server/taskStore';
import {
  getTask as getJwpkTask,
  updateTask as updateJwpkTask,
  isJwpkTaskStatus
} from '$lib/server/tasksStore';
import { dispatchPlanEvent } from '$lib/server/planTriggerDispatcher';
import { requireChatRoomMutationAuth, tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';

function requireAdminBearer(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
}

async function requireTaskReadAuth(request: Request, taskId: string): Promise<void> {
  const task = getJwpkTask(taskId);
  if (task?.roomId) {
    const room = findChatRoomById(task.roomId);
    if (room) {
      await requireChatRoomReadAccess(request, room);
      return;
    }
  }
  requireAdminBearer(request);
}

function requireTaskMutationAuth(
  request: Request,
  rawBody: Record<string, unknown> | null,
  taskId: string
): void {
  const task = getJwpkTask(taskId);
  if (task?.roomId) {
    const room = findChatRoomById(task.roomId);
    if (room) {
      requireChatRoomMutationAuth(room.id, request, rawBody);
      return;
    }
  }
  requireAdminBearer(request);
}

// JWPK PATCH detector: body that uses the JWPK shape (title/assigned_to/
// JWPK-enum status). Distinct from legacy fields (subject, assignedAgent,
// planId, etc.) so the two surfaces don't collide.
function isJwpkPatchBody(b: Record<string, unknown>): boolean {
  if (typeof b.title === 'string') return true;
  if ('assigned_to' in b) return true;
  if (typeof b.status === 'string' && isJwpkTaskStatus(b.status) && !isTaskStatus(b.status)) {
    return true;
  }
  return false;
}

export const GET: RequestHandler = async ({ params, request }) => {
  const task = getTask(params.taskId);
  if (!task) throw error(404, 'Task not found.');
  await requireTaskReadAuth(request, params.taskId);
  return json({ task });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const before = getTask(params.taskId);
  if (!before) throw error(404, 'Task not found.');
  const body = await request.json().catch(() => null);
  requireTaskMutationAuth(
    request,
    body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null,
    params.taskId
  );
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;

  // JWPK shape: route through tasksStore (handles title/assigned_to/
  // JWPK-enum status). The Lane-D ANTSCRIPT trigger fan-out is skipped
  // for pure JWPK patches by design — JWPK tasks are first-class and
  // don't carry planId/plan.completed semantics.
  if (isJwpkPatchBody(b)) {
    if (b.status !== undefined && !isJwpkTaskStatus(b.status)) {
      throw error(400, 'status must be one of todo|in_progress|done|cancelled|blocked.');
    }
    const patch: Parameters<typeof updateJwpkTask>[1] = {};
    if (typeof b.title === 'string') patch.title = b.title;
    if (typeof b.description === 'string') patch.description = b.description;
    if (isJwpkTaskStatus(b.status)) patch.status = b.status;
    if ('assigned_to' in b) {
      patch.assignedTo = typeof b.assigned_to === 'string' ? b.assigned_to : null;
    }
    const updated = updateJwpkTask(params.taskId, patch);
    return json({ task: updated });
  }

  if (b.status !== undefined && !isTaskStatus(b.status)) {
    throw error(400, 'status must be one of pending|in_progress|blocked|completed|deleted.');
  }
  if (b.priority !== undefined && b.priority !== null && typeof b.priority !== 'number') {
    throw error(400, 'priority must be a number or null.');
  }
  // Snapshot pre-state completion if this PATCH touches a plan-linked
  // task — used below to detect the <100% → 100% transition that fires
  // ANTSCRIPT plan.completed triggers.
  const preCompletion = before.planId !== null ? planCompletion(before.planId) : null;
  const updated = updateTask(params.taskId, {
    subject: typeof b.subject === 'string' ? b.subject : undefined,
    description: 'description' in b ? (b.description as string | null) : undefined,
    status: isTaskStatus(b.status) ? b.status : undefined,
    priority: 'priority' in b ? (b.priority as number | null) : undefined,
    planId: 'planId' in b ? (b.planId as string | null) : undefined,
    assignedAgent: 'assignedAgent' in b ? (b.assignedAgent as string | null) : undefined,
    evidence: 'evidence' in b ? (b.evidence as never[] | null) : undefined,
    workspaceIdentity:
      'workspaceIdentity' in b || 'workspace_identity' in b
        ? normalizeWorkspaceIdentity(b.workspaceIdentity ?? b.workspace_identity)
        : undefined,
    notes: 'notes' in b ? (b.notes as string | null) : undefined,
    startedAtMs: 'startedAtMs' in b ? (b.startedAtMs as number | null) : undefined,
    endedAtMs: 'endedAtMs' in b ? (b.endedAtMs as number | null) : undefined
  });
  // ANTSCRIPT lifecycle dispatch — fires on real transitions only
  // (status change, agent change, plan completion crossing 100%). All
  // dispatches go through dispatchPlanEvent which scopes to the task's
  // current planId; standalone tasks (planId null) only hit wildcard
  // triggers.
  if (updated) {
    const taskCtx = {
      id: updated.id,
      subject: updated.subject,
      status: updated.status,
      assignedAgent: updated.assignedAgent
    };

    // task.completed — status flipped to 'completed' from anything else.
    if (before.status !== 'completed' && updated.status === 'completed') {
      dispatchPlanEvent('task.completed', { planId: updated.planId, task: taskCtx });
    }
    // task.blocked — status flipped to 'blocked' from anything else.
    if (before.status !== 'blocked' && updated.status === 'blocked') {
      dispatchPlanEvent('task.blocked', { planId: updated.planId, task: taskCtx });
    }
    // task.assigned — assignedAgent flipped from null OR a different
    // handle to a non-null handle. Re-PATCHing the same agent is a no-op.
    if (
      updated.assignedAgent !== null &&
      before.assignedAgent !== updated.assignedAgent
    ) {
      dispatchPlanEvent('task.assigned', { planId: updated.planId, task: taskCtx });
    }

    // plan.completed — fires when the parent plan crosses <100% → 100%
    // because of this task PATCH. Snapshot pre+post and compare ratios.
    if (updated.planId !== null) {
      const post = planCompletion(updated.planId);
      const wasComplete = preCompletion !== null && preCompletion.pct >= 1;
      const isComplete = post.pct >= 1 && post.total > 0;
      if (!wasComplete && isComplete) {
        dispatchPlanEvent('plan.completed', {
          planId: updated.planId,
          completion: {
            total: post.total, completed: post.completed,
            pct: post.pct, title: post.title
          }
        });
      }
    }
  }
  return json({ task: updated });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!getTask(params.taskId)) throw error(404, 'Task not found.');
  requireTaskMutationAuth(request, null, params.taskId);
  deleteTask(params.taskId);
  return json({ ok: true });
};
