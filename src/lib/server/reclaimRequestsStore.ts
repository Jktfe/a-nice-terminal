/**
 * reclaimRequestsStore — PR-C super-admin reclaim CLI primitive (substrate
 * v0.2 plan, 2026-05-29).
 *
 * Replaces tonight's identity-surgery 4-hour raw-SQL forensic with a
 * named, signed (when Part 4 lands), audited recovery primitive.
 *
 * State machine (status column):
 *
 *   pending --approve--> approved --execute--> executed
 *      |                     |
 *      `--deny-> denied      `--deny-> denied
 *      |
 *      `--expire-> expired   (created_at + TTL exhaustion - operator/cron)
 *
 *   pending --execute--> executed (skip approval — admin-bearer is enough
 *                                   in Stage A; approval gate widens when
 *                                   org-admin attestation lands).
 *
 * executeReclaim dispatches on target_kind:
 *
 *   terminal    Flip terminals.status -> 'archived', soft-revoke any
 *               active room_memberships pointing at it.
 *   membership  Soft-revoke one room_memberships row (set revoked_at_ms).
 *   identity    NO-OP with warning until v0.2 identities table lives.
 *   session     NO-OP with warning until v0.2 sessions table lives.
 *
 * All actions are recorded in resulting_actions_json so the audit trail is
 * queryable on `ant reclaim show <id>`.
 *
 * Schema in db.ts SCHEMA_DDL_STATEMENTS (reclaim_requests table).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type ReclaimTargetKind = 'terminal' | 'membership' | 'identity' | 'session';
export type ReclaimStatus = 'pending' | 'approved' | 'executed' | 'denied' | 'expired';

export type ReclaimRequest = {
  reclaimId: string;
  requesterHandle: string;
  targetKind: ReclaimTargetKind;
  targetId: string;
  reason: string;
  diagnostic: Record<string, unknown> | null;
  status: ReclaimStatus;
  createdAtMs: number;
  approvedAtMs: number | null;
  approvedByHandle: string | null;
  executedAtMs: number | null;
  executedByHandle: string | null;
  resultingActions: ReclaimAction[] | null;
  signedPayload: string;
  signature: string | null;
};

export type ReclaimActionKind =
  | 'terminal_archived'
  | 'membership_revoked'
  | 'noop_identity_pending_v02'
  | 'noop_session_pending_v02'
  | 'unknown_target_warning';

export type ReclaimAction = {
  kind: ReclaimActionKind;
  detail: string;
  rowsAffected: number;
  dryRun: boolean;
};

type Row = {
  reclaim_id: string;
  requester_handle: string;
  target_kind: string;
  target_id: string;
  reason: string;
  diagnostic_json: string | null;
  status: string;
  created_at_ms: number;
  approved_at_ms: number | null;
  approved_by_handle: string | null;
  executed_at_ms: number | null;
  executed_by_handle: string | null;
  resulting_actions_json: string | null;
  signed_payload: string;
  signature: string | null;
};

function safeJsonParse<T>(raw: string | null): T | null {
  if (raw === null || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function rowToRequest(row: Row): ReclaimRequest {
  return {
    reclaimId: row.reclaim_id,
    requesterHandle: row.requester_handle,
    targetKind: row.target_kind as ReclaimTargetKind,
    targetId: row.target_id,
    reason: row.reason,
    diagnostic: safeJsonParse<Record<string, unknown>>(row.diagnostic_json),
    status: row.status as ReclaimStatus,
    createdAtMs: row.created_at_ms,
    approvedAtMs: row.approved_at_ms,
    approvedByHandle: row.approved_by_handle,
    executedAtMs: row.executed_at_ms,
    executedByHandle: row.executed_by_handle,
    resultingActions: safeJsonParse<ReclaimAction[]>(row.resulting_actions_json),
    signedPayload: row.signed_payload,
    signature: row.signature
  };
}

function fetchRowOrNull(reclaimId: string): Row | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM reclaim_requests WHERE reclaim_id = ?`)
    .get(reclaimId) as Row | undefined;
  return row ?? null;
}

function fetchRowOrThrow(reclaimId: string): Row {
  const row = fetchRowOrNull(reclaimId);
  if (row === null) {
    throw new Error(`reclaim request not found: ${reclaimId}`);
  }
  return row;
}

/**
 * Canonical JSON of the request — captured at create time so the audit
 * surface survives schema drift on later reads. Future signing layer
 * (Part 4 identity_keys) will sign exactly this string and store the
 * detached signature in the `signature` column.
 */
function buildSignedPayload(input: {
  reclaimId: string;
  requesterHandle: string;
  targetKind: ReclaimTargetKind;
  targetId: string;
  reason: string;
  diagnostic: Record<string, unknown> | null;
  createdAtMs: number;
}): string {
  return JSON.stringify({
    reclaim_id: input.reclaimId,
    requester_handle: input.requesterHandle,
    target_kind: input.targetKind,
    target_id: input.targetId,
    reason: input.reason,
    diagnostic: input.diagnostic,
    created_at_ms: input.createdAtMs
  });
}

export type CreateReclaimInput = {
  requesterHandle: string;
  targetKind: ReclaimTargetKind;
  targetId: string;
  reason: string;
  diagnostic?: Record<string, unknown> | null;
};

export function createReclaimRequest(input: CreateReclaimInput): ReclaimRequest {
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length === 0) {
    throw new Error('reason is required (non-empty after trim)');
  }
  const reclaimId = `rcl_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const createdAtMs = Date.now();
  const diagnostic = input.diagnostic ?? null;
  const signedPayload = buildSignedPayload({
    reclaimId,
    requesterHandle: input.requesterHandle,
    targetKind: input.targetKind,
    targetId: input.targetId,
    reason: trimmedReason,
    diagnostic,
    createdAtMs
  });
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO reclaim_requests
      (reclaim_id, requester_handle, target_kind, target_id, reason,
       diagnostic_json, status, created_at_ms, signed_payload)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    reclaimId,
    input.requesterHandle,
    input.targetKind,
    input.targetId,
    trimmedReason,
    diagnostic !== null ? JSON.stringify(diagnostic) : null,
    createdAtMs,
    signedPayload
  );
  return rowToRequest(fetchRowOrThrow(reclaimId));
}

export function getReclaimRequest(reclaimId: string): ReclaimRequest | null {
  const row = fetchRowOrNull(reclaimId);
  return row === null ? null : rowToRequest(row);
}

export function listPendingReclaims(): ReclaimRequest[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT * FROM reclaim_requests WHERE status = 'pending' ORDER BY created_at_ms ASC`
    )
    .all() as Row[];
  return rows.map(rowToRequest);
}

export function approveReclaim(input: {
  reclaimId: string;
  approvedByHandle: string;
}): ReclaimRequest {
  const row = fetchRowOrThrow(input.reclaimId);
  if (row.status !== 'pending') {
    throw new Error(
      `reclaim ${input.reclaimId} cannot be approved (status=${row.status}; only pending requests are approvable)`
    );
  }
  const db = getIdentityDb();
  db.prepare(
    `UPDATE reclaim_requests
       SET status = 'approved', approved_at_ms = ?, approved_by_handle = ?
     WHERE reclaim_id = ?`
  ).run(Date.now(), input.approvedByHandle, input.reclaimId);
  return rowToRequest(fetchRowOrThrow(input.reclaimId));
}

export function denyReclaim(input: {
  reclaimId: string;
  reason: string;
}): ReclaimRequest {
  const row = fetchRowOrThrow(input.reclaimId);
  if (row.status !== 'pending' && row.status !== 'approved') {
    throw new Error(
      `reclaim ${input.reclaimId} cannot be denied (status=${row.status}; only pending/approved requests are deniable)`
    );
  }
  const trimmed = input.reason.trim();
  if (trimmed.length === 0) {
    throw new Error('deny reason is required');
  }
  const db = getIdentityDb();
  // Use resulting_actions_json to store the deny reason — saves a column
  // and keeps the audit shape consistent with execute (both record what
  // happened to the request).
  const denyAction: ReclaimAction[] = [
    {
      kind: 'unknown_target_warning',
      detail: `denied: ${trimmed}`,
      rowsAffected: 0,
      dryRun: false
    }
  ];
  db.prepare(
    `UPDATE reclaim_requests
       SET status = 'denied', resulting_actions_json = ?
     WHERE reclaim_id = ?`
  ).run(JSON.stringify(denyAction), input.reclaimId);
  return rowToRequest(fetchRowOrThrow(input.reclaimId));
}

export function expireReclaim(input: { reclaimId: string }): ReclaimRequest {
  const row = fetchRowOrThrow(input.reclaimId);
  if (row.status !== 'pending' && row.status !== 'approved') {
    throw new Error(
      `reclaim ${input.reclaimId} cannot be expired (status=${row.status})`
    );
  }
  const db = getIdentityDb();
  db.prepare(
    `UPDATE reclaim_requests SET status = 'expired' WHERE reclaim_id = ?`
  ).run(input.reclaimId);
  return rowToRequest(fetchRowOrThrow(input.reclaimId));
}

/**
 * Dispatch on target_kind. Returns the request + the list of actions
 * taken (or simulated, when dryRun=true).
 *
 * dryRun=true returns the actions that WOULD run without touching any
 * rows AND without flipping the request status.
 */
export function executeReclaim(input: {
  reclaimId: string;
  executedByHandle: string;
  dryRun?: boolean;
}): { request: ReclaimRequest; actions: ReclaimAction[] } {
  const row = fetchRowOrThrow(input.reclaimId);
  if (row.status === 'executed') {
    throw new Error(`reclaim ${input.reclaimId} already executed`);
  }
  if (row.status === 'denied' || row.status === 'expired') {
    throw new Error(
      `reclaim ${input.reclaimId} cannot execute (status=${row.status})`
    );
  }
  const dryRun = input.dryRun === true;
  const targetKind = row.target_kind as ReclaimTargetKind;
  const actions: ReclaimAction[] = (() => {
    switch (targetKind) {
      case 'terminal':
        return runTerminalReclaim(row.target_id, dryRun);
      case 'membership':
        return runMembershipReclaim(row.target_id, dryRun);
      case 'identity':
        return [
          {
            kind: 'noop_identity_pending_v02',
            detail: `identity reclaim is a NO-OP until v0.2 identities table is live (targetId=${row.target_id})`,
            rowsAffected: 0,
            dryRun
          }
        ];
      case 'session':
        return [
          {
            kind: 'noop_session_pending_v02',
            detail: `session reclaim is a NO-OP until v0.2 sessions table is live (targetId=${row.target_id})`,
            rowsAffected: 0,
            dryRun
          }
        ];
      default:
        // Defensive — CHECK constraint should have caught this at insert.
        return [
          {
            kind: 'unknown_target_warning',
            detail: `unknown target_kind: ${String(targetKind)}`,
            rowsAffected: 0,
            dryRun
          }
        ];
    }
  })();

  if (!dryRun) {
    const db = getIdentityDb();
    db.prepare(
      `UPDATE reclaim_requests
         SET status = 'executed', executed_at_ms = ?, executed_by_handle = ?,
             resulting_actions_json = ?
       WHERE reclaim_id = ?`
    ).run(Date.now(), input.executedByHandle, JSON.stringify(actions), input.reclaimId);
  }

  return { request: rowToRequest(fetchRowOrThrow(input.reclaimId)), actions };
}

function runTerminalReclaim(terminalId: string, dryRun: boolean): ReclaimAction[] {
  const db = getIdentityDb();
  const terminalRow = db
    .prepare(`SELECT id, status FROM terminals WHERE id = ?`)
    .get(terminalId) as { id: string; status: string } | undefined;
  if (!terminalRow) {
    return [
      {
        kind: 'unknown_target_warning',
        detail: `no terminal row found for id=${terminalId} (already archived or never existed)`,
        rowsAffected: 0,
        dryRun
      }
    ];
  }
  // Count active memberships that would be revoked.
  const activeMemberships = db
    .prepare(
      `SELECT COUNT(*) AS n FROM room_memberships WHERE terminal_id = ? AND revoked_at_ms IS NULL`
    )
    .get(terminalId) as { n: number };

  if (dryRun) {
    return [
      {
        kind: 'terminal_archived',
        detail: `would flip terminals.status -> archived for id=${terminalId} (current=${terminalRow.status})`,
        rowsAffected: 1,
        dryRun: true
      },
      {
        kind: 'membership_revoked',
        detail: `would soft-revoke ${activeMemberships.n} active room_memberships rows bound to terminal=${terminalId}`,
        rowsAffected: activeMemberships.n,
        dryRun: true
      }
    ];
  }

  const nowMs = Date.now();
  const archiveResult = db
    .prepare(`UPDATE terminals SET status = 'archived', updated_at = ? WHERE id = ?`)
    .run(Math.floor(nowMs / 1000), terminalId);
  const revokeResult = db
    .prepare(
      `UPDATE room_memberships
         SET revoked_at_ms = ?
       WHERE terminal_id = ? AND revoked_at_ms IS NULL`
    )
    .run(nowMs, terminalId);
  return [
    {
      kind: 'terminal_archived',
      detail: `flipped terminals.status -> archived for id=${terminalId} (was=${terminalRow.status})`,
      rowsAffected: archiveResult.changes,
      dryRun: false
    },
    {
      kind: 'membership_revoked',
      detail: `soft-revoked ${revokeResult.changes} room_memberships rows bound to terminal=${terminalId}`,
      rowsAffected: revokeResult.changes,
      dryRun: false
    }
  ];
}

function runMembershipReclaim(membershipId: string, dryRun: boolean): ReclaimAction[] {
  const db = getIdentityDb();
  const membership = db
    .prepare(
      `SELECT id, room_id, handle, revoked_at_ms FROM room_memberships WHERE id = ?`
    )
    .get(membershipId) as
    | { id: string; room_id: string; handle: string; revoked_at_ms: number | null }
    | undefined;
  if (!membership) {
    return [
      {
        kind: 'unknown_target_warning',
        detail: `no room_memberships row found for id=${membershipId}`,
        rowsAffected: 0,
        dryRun
      }
    ];
  }
  if (membership.revoked_at_ms !== null) {
    return [
      {
        kind: 'membership_revoked',
        detail: `membership ${membershipId} (room=${membership.room_id} handle=${membership.handle}) is already revoked at ${membership.revoked_at_ms}`,
        rowsAffected: 0,
        dryRun
      }
    ];
  }
  if (dryRun) {
    return [
      {
        kind: 'membership_revoked',
        detail: `would soft-revoke membership ${membershipId} (room=${membership.room_id} handle=${membership.handle})`,
        rowsAffected: 1,
        dryRun: true
      }
    ];
  }
  const result = db
    .prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE id = ?`)
    .run(Date.now(), membershipId);
  return [
    {
      kind: 'membership_revoked',
      detail: `soft-revoked membership ${membershipId} (room=${membership.room_id} handle=${membership.handle})`,
      rowsAffected: result.changes,
      dryRun: false
    }
  ];
}

/**
 * Test-only helper — clears all reclaim_requests rows. Used by the store
 * tests' beforeEach so each test starts from an empty table. Production
 * code MUST NOT call this.
 */
export function resetReclaimRequestsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM reclaim_requests`).run();
}
