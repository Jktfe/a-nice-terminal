/**
 * permissionApproverResolver — Stage A approver lookup for the 403
 * PermissionDenied payload (plan milestone p3-stage-a-403-payload of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Each call returns the list of handles that CAN grant the requested
 * action on the requested target. The first entry is marked `preferred:
 * true` (e.g. the room owner over an org admin) so the CLI renderer can
 * highlight the canonical approver while still listing fallbacks.
 *
 * In Stage A this is a pure read-side lookup with no audit / writeback.
 * Stage B will replace this with a richer routing layer that also writes
 * the `permission_requests` audit row + dispatches to the approver's
 * modal/inbox.
 *
 * Failure mode: when the target cannot be located (e.g. room id doesn't
 * exist or has been deleted), the resolver returns an empty array rather
 * than throwing. The 403 builder still ships the payload — agents see a
 * structured "no approvers" hint and can fall back to a system admin or
 * a re-register cycle.
 */

import type {
  PermissionApprover,
  PermissionTargetKind
} from './permissionDeniedPayload';
import { findChatRoomById } from './chatRoomStore';
import { getPlan } from './planStore';
import { getTask } from './tasksStore';
import { listOrgAdmins } from './orgsStore';

export type ResolveApproversInput = {
  targetKind: PermissionTargetKind;
  targetId: string;
};

function normaliseHandle(handle: string): string {
  if (!handle) return handle;
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function approver(
  handle: string | null | undefined,
  role: string,
  preferred: boolean
): PermissionApprover | null {
  if (!handle || typeof handle !== 'string' || handle.length === 0) return null;
  return { handle: normaliseHandle(handle), role, preferred };
}

function resolveRoomApprovers(roomId: string): PermissionApprover[] {
  const room = findChatRoomById(roomId);
  if (!room) return [];
  const out: PermissionApprover[] = [];
  const owner = approver(room.whoCreatedIt, 'room_owner', true);
  if (owner) out.push(owner);
  // Stage A: org-admin resolution is per-room-org best-effort. We don't
  // yet store room→org binding as a column, so we surface global org
  // admins only when a future slice wires `chat_rooms.org_id`. For now,
  // skip org fallback at the room layer — the room_owner alone is the
  // canonical approver. (Stage B adds the join.)
  return out;
}

function resolvePlanApprovers(planId: string): PermissionApprover[] {
  const plan = getPlan(planId);
  if (!plan) return [];
  const out: PermissionApprover[] = [];
  const owner = approver(plan.createdBy, 'plan_owner', true);
  if (owner) out.push(owner);
  return out;
}

function resolveTaskApprovers(taskId: string): PermissionApprover[] {
  const task = getTask(taskId);
  if (!task) return [];
  const out: PermissionApprover[] = [];
  // Task assignee is preferred over plan owner — they're the one being
  // asked to do the work; the plan owner is the fallback approver.
  const assignee = approver(task.assignedTerminalId ?? null, 'task_assignee', true);
  if (assignee) out.push(assignee);
  if (task.planId) {
    const plan = getPlan(task.planId);
    const planOwner = approver(
      plan?.createdBy ?? null,
      'plan_owner',
      out.length === 0 // preferred only when no assignee
    );
    if (planOwner) out.push(planOwner);
  }
  // Falls back to createdBy as a final approver when neither task
  // assignee nor plan owner resolves — at minimum surface SOMEONE.
  if (out.length === 0) {
    const creator = approver(task.createdBy ?? null, 'task_creator', true);
    if (creator) out.push(creator);
  }
  return out;
}

function resolveOrgApprovers(orgId: string): PermissionApprover[] {
  const admins = listOrgAdmins(orgId);
  return admins.map((admin, index) => ({
    handle: normaliseHandle(admin.handle),
    role: 'org_admin',
    preferred: index === 0
  }));
}

function resolveSystemApprovers(): PermissionApprover[] {
  // Stage A: system-admin enumeration isn't wired through a dedicated
  // table; the canonical surface is the ANT_ADMIN_TOKEN bearer. Return
  // an empty list — the 403 payload still renders the approve_command
  // for the operator to relay to whoever holds the admin bearer.
  return [];
}

/**
 * Look up the approver list for a given target. Stage A: pure read,
 * no audit write. Returns [] when target cannot be located so callers
 * never have to nil-check.
 */
export function resolveApproversFor(
  input: ResolveApproversInput
): PermissionApprover[] {
  switch (input.targetKind) {
    case 'room':
      return resolveRoomApprovers(input.targetId);
    case 'plan':
      return resolvePlanApprovers(input.targetId);
    case 'task':
      return resolveTaskApprovers(input.targetId);
    case 'org':
      return resolveOrgApprovers(input.targetId);
    case 'system':
      return resolveSystemApprovers();
    default: {
      const _exhaustive: never = input.targetKind;
      return _exhaustive;
    }
  }
}
