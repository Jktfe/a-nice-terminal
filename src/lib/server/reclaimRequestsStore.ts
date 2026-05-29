/**
 * reclaimRequestsStore — the v0.2 recovery primitive.
 *
 * The named recovery path that replaces today's 4-hour SQL forensic with a
 * 2-line CLI invocation. When @TigerResearch's laptop dies and they spin
 * up a new tmux pane on their Mac mini, the new shell registers, then the
 * super-admin (or self-approve) runs `ant admin reclaim --agent TigerResearch`.
 * This store records the request -> approve -> execute lifecycle and
 * performs the ATOMIC SWAP that moves every active membership from the
 * old runtime to the new one, archives the old runtime, and emits a single
 * audit-shaped log line.
 *
 * Spec: docs/concepts/ant-v02-identity-and-recovery.md §Recovery Layer +
 * §TigerResearch Recovery Flow + §Three Structural Invariants.
 *
 * Scope of this PR (PR-C of v0.2):
 *   - Single-agent reclaim only (multi-agent --all-stale ships in PR-D+).
 *   - `agent_id` is a v0.2 stand-in: terminal_records.session_id of the
 *     target. The native `agents` table arrives later in v0.2.
 *   - `new_runtime_challenge` is an opaque token until ed25519 signed
 *     challenges land.
 *
 * Atomic swap (executeReclaimRequest) is wrapped in a single SQLite
 * transaction so a crash mid-swap leaves either every membership pointing
 * at the new runtime, or every membership pointing at the old one — never
 * a split where some have flipped and others haven't.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type ReclaimRequestStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';

export type ReclaimRequestRow = {
  request_id: string;
  agent_id: string;
  old_runtime_id: string | null;
  new_runtime_id: string;
  new_runtime_challenge: string;
  requested_by_agent_id: string;
  requested_at_ms: number;
  approved_by_agent_id: string | null;
  approved_at_ms: number | null;
  executed_at_ms: number | null;
  status: ReclaimRequestStatus;
  rejected_reason: string | null;
  expires_at_ms: number;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export type CreateReclaimRequestInput = {
  agentId: string;
  oldRuntimeId: string | null;
  newRuntimeId: string;
  challenge: string;
  requestedByAgentId: string;
  nowMs: number;
  ttlMs?: number;
};

export type CreateReclaimRequestResult = {
  requestId: string;
  expiresAtMs: number;
};

export function createReclaimRequest(input: CreateReclaimRequestInput): CreateReclaimRequestResult {
  const db = getIdentityDb();
  const ttlMs = typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL_MS;
  const expiresAtMs = input.nowMs + ttlMs;
  const requestId = `rcm_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(`INSERT INTO reclaim_requests (
    request_id, agent_id, old_runtime_id, new_runtime_id, new_runtime_challenge,
    requested_by_agent_id, requested_at_ms, status, expires_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
    requestId,
    input.agentId,
    input.oldRuntimeId,
    input.newRuntimeId,
    input.challenge,
    input.requestedByAgentId,
    input.nowMs,
    expiresAtMs
  );
  return { requestId, expiresAtMs };
}

export function getReclaimRequest(requestId: string): ReclaimRequestRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM reclaim_requests WHERE request_id = ?`)
    .get(requestId) as ReclaimRequestRow | undefined;
  return row ?? null;
}

export function listPendingReclaimRequestsForAgent(agentId: string): ReclaimRequestRow[] {
  const db = getIdentityDb();
  return db.prepare(
    `SELECT * FROM reclaim_requests WHERE agent_id = ? AND status = 'pending'
     ORDER BY requested_at_ms DESC`
  ).all(agentId) as ReclaimRequestRow[];
}

export type ApproveReclaimRequestInput = {
  requestId: string;
  approverAgentId: string;
  nowMs: number;
};

export type ApproveReclaimRequestResult =
  | { ok: true; status: 'approved' }
  | { ok: false; reason: 'not-found' | 'not-pending' | 'expired' };

export function approveReclaimRequest(input: ApproveReclaimRequestInput): ApproveReclaimRequestResult {
  const db = getIdentityDb();
  const row = getReclaimRequest(input.requestId);
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.status !== 'pending') return { ok: false, reason: 'not-pending' };
  if (row.expires_at_ms <= input.nowMs) {
    // Reflect the lapsed state in storage so subsequent reads see it.
    db.prepare(`UPDATE reclaim_requests SET status = 'expired' WHERE request_id = ? AND status = 'pending'`)
      .run(input.requestId);
    return { ok: false, reason: 'expired' };
  }
  db.prepare(`UPDATE reclaim_requests SET status = 'approved',
    approved_by_agent_id = ?, approved_at_ms = ? WHERE request_id = ? AND status = 'pending'`)
    .run(input.approverAgentId, input.nowMs, input.requestId);
  return { ok: true, status: 'approved' };
}

export type ExecuteReclaimRequestInput = {
  requestId: string;
  nowMs: number;
};

export type ExecuteReclaimRequestResult =
  | { ok: true; affectedRoomIds: string[]; oldArchived: boolean }
  | { ok: false; reason: 'not-found' | 'not-approved' | 'expired' };

/**
 * Atomic swap. Wrapped in a single SQLite transaction so partial failure
 * is impossible: either every active membership flips to the new runtime
 * and the old runtime archives in one go, or the whole operation rolls
 * back and the reclaim_request stays approved (so a retry can succeed).
 */
export function executeReclaimRequest(input: ExecuteReclaimRequestInput): ExecuteReclaimRequestResult {
  const db = getIdentityDb();
  const initialRow = getReclaimRequest(input.requestId);
  if (!initialRow) return { ok: false, reason: 'not-found' };
  if (initialRow.status !== 'approved') return { ok: false, reason: 'not-approved' };
  if (initialRow.expires_at_ms <= input.nowMs) {
    db.prepare(`UPDATE reclaim_requests SET status = 'expired' WHERE request_id = ? AND status = 'approved'`)
      .run(input.requestId);
    return { ok: false, reason: 'expired' };
  }

  let affectedRoomIds: string[] = [];
  let oldArchived = false;

  const swap = db.transaction(() => {
    // 1. Snapshot the affected room ids BEFORE the UPDATE so the response
    //    can include them. revoked_at_ms IS NULL filter keeps the swap
    //    scoped to active memberships only.
    if (initialRow.old_runtime_id !== null) {
      const rows = db.prepare(
        `SELECT room_id FROM room_memberships
         WHERE terminal_id = ? AND revoked_at_ms IS NULL`
      ).all(initialRow.old_runtime_id) as { room_id: string }[];
      affectedRoomIds = rows.map((r) => r.room_id);

      // 2. Flip every active membership to the new runtime.
      db.prepare(
        `UPDATE room_memberships SET terminal_id = ?
         WHERE terminal_id = ? AND revoked_at_ms IS NULL`
      ).run(initialRow.new_runtime_id, initialRow.old_runtime_id);

      // 3. Archive the old runtime row. Idempotent: skip if already archived
      //    or deleted (status check filters those out so it's a no-op).
      const archiveInfo = db.prepare(
        `UPDATE terminals SET status = 'archived', updated_at = ?
         WHERE id = ? AND status = 'live'`
      ).run(Math.floor(input.nowMs / 1000), initialRow.old_runtime_id);
      oldArchived = archiveInfo.changes > 0;
    }

    // 4. Mark the reclaim_request executed.
    db.prepare(
      `UPDATE reclaim_requests SET status = 'executed', executed_at_ms = ?
       WHERE request_id = ? AND status = 'approved'`
    ).run(input.nowMs, input.requestId);
  });

  swap();
  return { ok: true, affectedRoomIds, oldArchived };
}

export function expireStaleReclaimRequests(nowMs: number): number {
  const db = getIdentityDb();
  const info = db.prepare(
    `UPDATE reclaim_requests SET status = 'expired'
     WHERE status = 'pending' AND expires_at_ms <= ?`
  ).run(nowMs);
  return info.changes;
}
