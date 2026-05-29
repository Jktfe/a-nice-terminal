/**
 * permissionRequestsStore — Stage B substrate (plan milestone
 * p3-stage-b-permission-requests of ant-substrate-v0.2-2026-05-29).
 *
 * The flow Stage B unlocks:
 *   1. Agent hits a 403 with a `permission_denied` payload (Stage A).
 *   2. Agent (or CLI auto-flag) POSTs the original action to
 *      /api/permission-requests with the pending HTTP body parked inside.
 *   3. Substrate writes a `permission_requests` row + a `pending_actions`
 *      row (TTL 5 minutes) so the approver inbox + the CLI poller both
 *      have a stable handle.
 *   4. Approver POSTs /api/permission-requests/:id/approve.
 *   5. Substrate writes a grants_shim row + flips status=approved +
 *      flips pending_actions.replay_status='ready_for_replay'.
 *   6. Original CLI caller polls GET /api/permission-requests/:id, sees
 *      ready_for_replay, retries the original action, then writes back
 *      replay_status='replayed_by_caller' for the audit trail.
 *
 * Modal routing (push to approver devices) is out of scope for this
 * substrate slice — that depends on antos + antchat apps. The store +
 * endpoints emit the rows that the apps will hook into.
 *
 * TTL sweep: sweepExpiredPendingActions() flips
 * pending_actions.replay_status='expired' AND request.status='expired'
 * for any row whose expires_at_ms < now. Run from a cron entry every
 * minute; cheap idempotent UPDATE so safe to call frequently.
 *
 * Auth model: the store layer is write-through; the calling endpoint is
 * responsible for verifying the approver gate (reuses Stage A's
 * permissionApproverResolver). The store does not enforce who can
 * create / approve / deny — that lives one layer up.
 */

import { randomBytes } from 'node:crypto';
import { getIdentityDb } from './db';
import type {
  PermissionApprover,
  PermissionTargetKind
} from './permissionDeniedPayload';
import { grantPermission, type GrantRecord, type GrantScope } from './grantsShimStore';

export const DEFAULT_PENDING_ACTION_TTL_MS = 5 * 60 * 1000;

export type PermissionRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'superseded';

export type PendingActionReplayStatus =
  | 'pending'
  | 'ready_for_replay'
  | 'replayed_by_caller'
  | 'expired'
  | 'denied';

export type PermissionRequest = {
  requestId: string;
  requesterHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  reason: string | null;
  approverHandles: PermissionApprover[];
  status: PermissionRequestStatus;
  createdAtMs: number;
  decidedAtMs: number | null;
  decidedByHandle: string | null;
  decisionScope: GrantScope;
  resultingGrantId: string | null;
  pendingActionId: string | null;
};

export type PendingAction = {
  actionId: string;
  requestId: string;
  httpMethod: string;
  httpPath: string;
  payloadJson: string;
  headersJson: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  replayedAtMs: number | null;
  replayStatus: PendingActionReplayStatus | null;
};

type PermissionRequestRow = {
  request_id: string;
  requester_handle: string;
  action: string;
  target_kind: string;
  target_id: string;
  reason: string | null;
  approver_handles_json: string;
  status: string;
  created_at_ms: number;
  decided_at_ms: number | null;
  decided_by_handle: string | null;
  decision_scope: string | null;
  resulting_grant_id: string | null;
  pending_action_id: string | null;
};

type PendingActionRow = {
  action_id: string;
  request_id: string;
  http_method: string;
  http_path: string;
  payload_json: string;
  headers_json: string | null;
  created_at_ms: number;
  expires_at_ms: number;
  replayed_at_ms: number | null;
  replay_status: string | null;
};

function normaliseHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function generateRequestId(): string {
  return `req_${randomBytes(8).toString('hex')}`;
}

function generateActionId(): string {
  return `pa_${randomBytes(8).toString('hex')}`;
}

function rowToRequest(row: PermissionRequestRow): PermissionRequest {
  let approvers: PermissionApprover[] = [];
  try {
    const parsed = JSON.parse(row.approver_handles_json) as unknown;
    if (Array.isArray(parsed)) {
      approvers = parsed.filter(
        (entry): entry is PermissionApprover =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as { handle?: unknown }).handle === 'string'
      );
    }
  } catch {
    approvers = [];
  }
  return {
    requestId: row.request_id,
    requesterHandle: row.requester_handle,
    action: row.action,
    targetKind: row.target_kind as PermissionTargetKind,
    targetId: row.target_id,
    reason: row.reason,
    approverHandles: approvers,
    status: row.status as PermissionRequestStatus,
    createdAtMs: row.created_at_ms,
    decidedAtMs: row.decided_at_ms,
    decidedByHandle: row.decided_by_handle,
    decisionScope: (row.decision_scope as GrantScope | null) ?? 'once',
    resultingGrantId: row.resulting_grant_id,
    pendingActionId: row.pending_action_id
  };
}

function rowToPendingAction(row: PendingActionRow): PendingAction {
  return {
    actionId: row.action_id,
    requestId: row.request_id,
    httpMethod: row.http_method,
    httpPath: row.http_path,
    payloadJson: row.payload_json,
    headersJson: row.headers_json,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    replayedAtMs: row.replayed_at_ms,
    replayStatus: (row.replay_status as PendingActionReplayStatus | null) ?? null
  };
}

export type CreatePermissionRequestInput = {
  requesterHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  reason?: string;
  approvers: PermissionApprover[];
  pendingAction?: {
    httpMethod: string;
    httpPath: string;
    payloadJson: string;
    headersJson?: string;
    ttlMs?: number;
  };
  /** Override the wall-clock for tests. */
  nowMs?: number;
};

export type CreatePermissionRequestResult = {
  request: PermissionRequest;
  pendingAction: PendingAction | null;
};

/**
 * Atomically write a permission_requests row and (optionally) an
 * accompanying pending_actions row. Returns the inserted records. The
 * request status starts at 'pending'; the pending action's replay_status
 * starts at 'pending' too — both flip together on approveRequest.
 */
export function createPermissionRequest(
  input: CreatePermissionRequestInput
): CreatePermissionRequestResult {
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const requestId = generateRequestId();
  const requesterHandle = normaliseHandle(input.requesterHandle);
  const approverJson = JSON.stringify(input.approvers ?? []);
  const pendingActionId = input.pendingAction ? generateActionId() : null;

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO permission_requests
         (request_id, requester_handle, action, target_kind, target_id,
          reason, approver_handles_json, status, created_at_ms,
          decided_at_ms, decided_by_handle, decision_scope,
          resulting_grant_id, pending_action_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, 'once', NULL, ?)`
    ).run(
      requestId,
      requesterHandle,
      input.action,
      input.targetKind,
      input.targetId,
      input.reason ?? null,
      approverJson,
      nowMs,
      pendingActionId
    );
    if (input.pendingAction && pendingActionId) {
      const ttl = input.pendingAction.ttlMs ?? DEFAULT_PENDING_ACTION_TTL_MS;
      db.prepare(
        `INSERT INTO pending_actions
           (action_id, request_id, http_method, http_path, payload_json,
            headers_json, created_at_ms, expires_at_ms, replayed_at_ms,
            replay_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending')`
      ).run(
        pendingActionId,
        requestId,
        input.pendingAction.httpMethod,
        input.pendingAction.httpPath,
        input.pendingAction.payloadJson,
        input.pendingAction.headersJson ?? null,
        nowMs,
        nowMs + ttl
      );
    }
  });
  txn();

  const requestRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(requestId) as PermissionRequestRow;
  let pendingActionRecord: PendingAction | null = null;
  if (pendingActionId) {
    const paRow = db
      .prepare(`SELECT * FROM pending_actions WHERE action_id = ?`)
      .get(pendingActionId) as PendingActionRow | undefined;
    if (paRow) pendingActionRecord = rowToPendingAction(paRow);
  }
  return {
    request: rowToRequest(requestRow),
    pendingAction: pendingActionRecord
  };
}

export type ApproveRequestInput = {
  requestId: string;
  decidedByHandle: string;
  decisionScope?: GrantScope;
  /** Override the wall-clock for tests. */
  nowMs?: number;
};

export type ApproveRequestResult = {
  request: PermissionRequest;
  grant: GrantRecord;
  pendingAction: PendingAction | null;
};

/**
 * Atomically flip a pending request to approved, write a grants_shim row,
 * and (if the request has a non-expired pending_action attached) flip the
 * pending_action's replay_status to 'ready_for_replay'. Throws when the
 * request is missing or already decided.
 *
 * Returns the updated request + the new grant + the (possibly updated)
 * pending action, all in their post-state shapes.
 */
export function approveRequest(input: ApproveRequestInput): ApproveRequestResult {
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const decidedBy = normaliseHandle(input.decidedByHandle);
  const scope = input.decisionScope ?? 'once';

  const existingRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(input.requestId) as PermissionRequestRow | undefined;
  if (!existingRow) {
    throw new Error(`permission_request not found: ${input.requestId}`);
  }
  if (existingRow.status !== 'pending') {
    throw new Error(
      `permission_request ${input.requestId} cannot be approved from status=${existingRow.status}`
    );
  }

  const existing = rowToRequest(existingRow);
  // Write the grant outside the txn — grantPermission generates its own id
  // and writes directly. We capture the grant_id to wire into the request
  // row inside the same transaction below.
  const grant = grantPermission({
    granteeHandle: existing.requesterHandle,
    action: existing.action,
    targetKind: existing.targetKind,
    targetId: existing.targetId,
    grantedByHandle: decidedBy,
    scope,
    nowMs
  });

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE permission_requests
          SET status = 'approved',
              decided_at_ms = ?,
              decided_by_handle = ?,
              decision_scope = ?,
              resulting_grant_id = ?
        WHERE request_id = ?`
    ).run(nowMs, decidedBy, scope, grant.grantId, input.requestId);
    if (existing.pendingActionId) {
      // Only flip a pending_action that is still 'pending' AND not yet
      // expired. An already-expired pending_action stays expired — the
      // approver's grant lands, the audit row is correct, but the CLI
      // poller will see expired and bail out instead of replaying stale
      // state.
      db.prepare(
        `UPDATE pending_actions
            SET replay_status = 'ready_for_replay'
          WHERE action_id = ?
            AND replay_status = 'pending'
            AND expires_at_ms > ?`
      ).run(existing.pendingActionId, nowMs);
    }
  });
  txn();

  const updatedRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(input.requestId) as PermissionRequestRow;
  let pendingActionRecord: PendingAction | null = null;
  if (existing.pendingActionId) {
    const paRow = db
      .prepare(`SELECT * FROM pending_actions WHERE action_id = ?`)
      .get(existing.pendingActionId) as PendingActionRow | undefined;
    if (paRow) pendingActionRecord = rowToPendingAction(paRow);
  }
  return {
    request: rowToRequest(updatedRow),
    grant,
    pendingAction: pendingActionRecord
  };
}

export type DenyRequestInput = {
  requestId: string;
  decidedByHandle: string;
  reason?: string;
  /** Override the wall-clock for tests. */
  nowMs?: number;
};

/**
 * Flip a pending request to denied and mark any attached pending_action
 * replay_status='denied' so the CLI poller bails. Throws when the
 * request is missing or already decided.
 */
export function denyRequest(input: DenyRequestInput): PermissionRequest {
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const decidedBy = normaliseHandle(input.decidedByHandle);

  const existingRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(input.requestId) as PermissionRequestRow | undefined;
  if (!existingRow) {
    throw new Error(`permission_request not found: ${input.requestId}`);
  }
  if (existingRow.status !== 'pending') {
    throw new Error(
      `permission_request ${input.requestId} cannot be denied from status=${existingRow.status}`
    );
  }

  const existing = rowToRequest(existingRow);
  const txn = db.transaction(() => {
    // Optionally append the deny reason to the request.reason text — the
    // schema only has one `reason` column shared between the originating
    // 403 reason and the deny note, so we prepend a tag when both exist.
    const reasonOnRecord = input.reason
      ? existing.reason
        ? `${existing.reason} | denied: ${input.reason}`
        : `denied: ${input.reason}`
      : existing.reason;
    db.prepare(
      `UPDATE permission_requests
          SET status = 'denied',
              decided_at_ms = ?,
              decided_by_handle = ?,
              reason = ?
        WHERE request_id = ?`
    ).run(nowMs, decidedBy, reasonOnRecord, input.requestId);
    if (existing.pendingActionId) {
      db.prepare(
        `UPDATE pending_actions
            SET replay_status = 'denied'
          WHERE action_id = ?
            AND replay_status = 'pending'`
      ).run(existing.pendingActionId);
    }
  });
  txn();

  const updatedRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(input.requestId) as PermissionRequestRow;
  return rowToRequest(updatedRow);
}

/**
 * Expire a single pending request. Used by the TTL sweep + by tests for
 * deterministic state.
 */
export function expireRequest(input: { requestId: string; nowMs?: number }): PermissionRequest {
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const existingRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(input.requestId) as PermissionRequestRow | undefined;
  if (!existingRow) {
    throw new Error(`permission_request not found: ${input.requestId}`);
  }
  if (existingRow.status !== 'pending') {
    // Idempotent — already-decided requests cannot be expired; just
    // return the current state without throwing.
    return rowToRequest(existingRow);
  }
  const existing = rowToRequest(existingRow);
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE permission_requests
          SET status = 'expired',
              decided_at_ms = ?
        WHERE request_id = ?
          AND status = 'pending'`
    ).run(nowMs, input.requestId);
    if (existing.pendingActionId) {
      db.prepare(
        `UPDATE pending_actions
            SET replay_status = 'expired'
          WHERE action_id = ?
            AND replay_status = 'pending'`
      ).run(existing.pendingActionId);
    }
  });
  txn();
  const updatedRow = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(input.requestId) as PermissionRequestRow;
  return rowToRequest(updatedRow);
}

export function getPermissionRequest(requestId: string): PermissionRequest | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM permission_requests WHERE request_id = ?`)
    .get(requestId) as PermissionRequestRow | undefined;
  if (!row) return null;
  return rowToRequest(row);
}

export function getPendingActionForRequest(requestId: string): PendingAction | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM pending_actions WHERE request_id = ? ORDER BY created_at_ms DESC LIMIT 1`)
    .get(requestId) as PendingActionRow | undefined;
  if (!row) return null;
  return rowToPendingAction(row);
}

/**
 * Confirm the CLI caller has replayed the original action. Idempotent;
 * only flips rows where replay_status='ready_for_replay'. Returns true
 * iff a row was flipped (used by tests + the CLI to verify the write
 * landed).
 */
export function markPendingActionReplayed(input: {
  actionId: string;
  nowMs?: number;
}): boolean {
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const result = db
    .prepare(
      `UPDATE pending_actions
          SET replay_status = 'replayed_by_caller',
              replayed_at_ms = ?
        WHERE action_id = ?
          AND replay_status = 'ready_for_replay'`
    )
    .run(nowMs, input.actionId);
  return result.changes > 0;
}

/**
 * Return every pending request whose target a given handle can approve.
 * Used by inbox-room rendering + the `ant request list --approver` CLI.
 * Note: the approver list is captured at request creation time (snapshot
 * semantics), so handing in @jwpk returns requests where @jwpk was an
 * approver at the moment of creation — not "any request @jwpk can
 * currently approve given today's room owner". The snapshot model
 * matches Stage A's payload contract (approvers shown to the caller
 * are stable for that request).
 */
export function listPendingForApprover(handle: string): PermissionRequest[] {
  const db = getIdentityDb();
  const normalised = normaliseHandle(handle);
  const rows = db
    .prepare(
      `SELECT * FROM permission_requests
        WHERE status = 'pending'
        ORDER BY created_at_ms ASC`
    )
    .all() as PermissionRequestRow[];
  const out: PermissionRequest[] = [];
  for (const row of rows) {
    const record = rowToRequest(row);
    if (record.approverHandles.some((a) => a.handle === normalised)) {
      out.push(record);
    }
  }
  return out;
}

/**
 * List every pending request created by a particular handle. Used by
 * the default `ant request list` (no --approver flag).
 */
export function listPendingForRequester(handle: string): PermissionRequest[] {
  const db = getIdentityDb();
  const normalised = normaliseHandle(handle);
  const rows = db
    .prepare(
      `SELECT * FROM permission_requests
        WHERE requester_handle = ? AND status = 'pending'
        ORDER BY created_at_ms DESC`
    )
    .all(normalised) as PermissionRequestRow[];
  return rows.map(rowToRequest);
}

/**
 * TTL housekeeping. Flip every pending_action whose expires_at_ms < now
 * to replay_status='expired' + the parent request to status='expired'.
 * Cheap idempotent UPDATE — safe to call every 60s from the cron entry.
 * Returns counts so the cron log can show what was swept.
 */
export function sweepExpiredPendingActions(nowMs: number = Date.now()): {
  expired: number;
  requestsExpired: number;
} {
  const db = getIdentityDb();
  // Stage 1: discover the expired pending_action rows + their parent request ids.
  const expiredRows = db
    .prepare(
      `SELECT action_id, request_id FROM pending_actions
        WHERE replay_status = 'pending'
          AND expires_at_ms < ?`
    )
    .all(nowMs) as Array<{ action_id: string; request_id: string }>;

  if (expiredRows.length === 0) return { expired: 0, requestsExpired: 0 };

  const txn = db.transaction(() => {
    const flipActions = db.prepare(
      `UPDATE pending_actions
          SET replay_status = 'expired'
        WHERE action_id = ?
          AND replay_status = 'pending'`
    );
    const flipRequests = db.prepare(
      `UPDATE permission_requests
          SET status = 'expired',
              decided_at_ms = ?
        WHERE request_id = ?
          AND status = 'pending'`
    );
    for (const row of expiredRows) {
      flipActions.run(row.action_id);
      flipRequests.run(nowMs, row.request_id);
    }
  });
  txn();

  // Count requests actually transitioned — requests without an attached
  // pending_action are not expired via this sweep (they stay pending
  // until explicit deny/expire). This matches the spec: the sweep is
  // specifically about parked action TTL.
  return {
    expired: expiredRows.length,
    requestsExpired: expiredRows.length
  };
}

/**
 * Test-only helper: list every request row regardless of status. Useful
 * for store tests that need to inspect the full state after a sweep or
 * approve/deny cycle.
 */
export function listAllPermissionRequestsForTests(): PermissionRequest[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT * FROM permission_requests ORDER BY created_at_ms ASC`)
    .all() as PermissionRequestRow[];
  return rows.map(rowToRequest);
}

export function listAllPendingActionsForTests(): PendingAction[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT * FROM pending_actions ORDER BY created_at_ms ASC`)
    .all() as PendingActionRow[];
  return rows.map(rowToPendingAction);
}

/**
 * Test reset. Truncates both tables; the per-worker VITEST DB
 * isolation in db.ts already mitigates cross-worker collisions, but
 * a per-test reset keeps assertions deterministic.
 */
export function resetPermissionRequestsForTests(): void {
  const db = getIdentityDb();
  // pending_actions FK-references permission_requests; drop children first.
  db.prepare(`DELETE FROM pending_actions`).run();
  db.prepare(`DELETE FROM permission_requests`).run();
}
