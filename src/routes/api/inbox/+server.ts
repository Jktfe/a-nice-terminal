/**
 * GET /api/inbox — the global held-ask + owner-notification surface.
 *
 * JWPK taste rulings (ANT sorted msg_n4gdutadlh + msg_lnaxbotljh,
 * 2026-06-10): notifications land in an INBOX rather than as room-post
 * noise; open asks appear BOTH globally and in their origin room — the
 * room half is the ?roomId= filter, consumed by the room-block view.
 *
 * Items:
 *  - heldAsks: pending permission_requests where the viewer is an approver
 *    (admin bearer sees all — the operator is the appeals court). Each
 *    carries the typeable approve command — approval itself rides the
 *    post path's witnessed identity, so approving is a ledgered act.
 *  - ownerNotifications: owner.notified ledger rows (vacant-claim and
 *    siblings) where the viewer is in the notified owners list.
 *
 * Auth mirrors /api/asks: resolveChatRoomReadAccess (admin / accounts /
 * browser / ant-session) — the same two identity classes as everywhere.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import {
  getPermissionRequest,
  listPendingForApprover,
  type PermissionRequest
} from '$lib/server/permissionRequestsStore';
import { getIdentityDb } from '$lib/server/db';
import { listLedger, type IdentityLedgerRow } from '$lib/server/identityLedgerStore';

type HeldAskView = {
  requestId: string;
  requesterHandle: string;
  action: string;
  targetKind: string;
  targetId: string;
  createdAtMs: number;
  approvers: { handle: string; role: string; preferred: boolean }[];
  /** The typeable form — reply-in-chat or paste in any room the viewer is in. */
  approveCommand: string;
};

function toHeldAskView(request: PermissionRequest): HeldAskView {
  return {
    requestId: request.requestId,
    requesterHandle: request.requesterHandle,
    action: request.action,
    targetKind: request.targetKind,
    targetId: request.targetId,
    createdAtMs: request.createdAtMs,
    approvers: request.approverHandles,
    approveCommand: `approve ${request.requestId}`
  };
}

function listAllPendingRequests(): PermissionRequest[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT request_id FROM permission_requests WHERE status = 'pending' ORDER BY created_at_ms ASC`)
    .all() as { request_id: string }[];
  // Admin view re-reads per id through the public getter so the store keeps
  // one row-mapping path.
  return rows
    .map((row) => getPermissionRequest(row.request_id))
    .filter((request): request is PermissionRequest => request !== null);
}

function ownerNotificationsFor(handles: string[] | null): IdentityLedgerRow[] {
  const recent = listLedger({ limit: 500 }).filter((row) => row.kind === 'owner.notified');
  if (handles === null) return recent; // admin: all
  const wanted = new Set(handles);
  return recent.filter((row) => {
    const owners = (row.detail?.owners ?? []) as string[];
    return Array.isArray(owners) && owners.some((owner) => wanted.has(owner));
  });
}

export const GET: RequestHandler = async ({ request, url }) => {
  const access = await resolveChatRoomReadAccess(request);
  if (!access) throw error(401, 'Authentication required.');

  const roomIdRaw = url.searchParams.get('roomId');
  const roomId = roomIdRaw === null ? null : roomIdRaw.trim();

  let heldAsks: PermissionRequest[];
  if (access.isAdminBearer) {
    heldAsks = listAllPendingRequests();
  } else {
    const seen = new Set<string>();
    heldAsks = [];
    for (const handle of access.handles) {
      for (const pending of listPendingForApprover(handle)) {
        if (seen.has(pending.requestId)) continue;
        seen.add(pending.requestId);
        heldAsks.push(pending);
      }
    }
  }
  if (roomId !== null && roomId.length > 0) {
    heldAsks = heldAsks.filter(
      (pending) => pending.targetKind === 'room' && pending.targetId === roomId
    );
  }

  const ownerNotifications = ownerNotificationsFor(
    access.isAdminBearer ? null : access.handles
  );

  return json({
    heldAsks: heldAsks.map(toHeldAskView),
    ownerNotifications: ownerNotifications.map((row) => ({
      atMs: row.at_ms,
      handle: row.handle,
      reason: (row.detail?.reason as string | undefined) ?? null,
      owners: (row.detail?.owners as string[] | undefined) ?? [],
      pane: (row.detail?.pane as string | undefined) ?? null
    }))
  });
};
