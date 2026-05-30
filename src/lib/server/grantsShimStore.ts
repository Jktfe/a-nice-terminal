/**
 * grantsShimStore — Stage A grants table (plan milestone
 * p3-stage-a-grant-cli of ant-substrate-v0.2-2026-05-29).
 *
 * Why a shim, not the v0.2 `grants` table:
 *   The full v0.2 grants design adds `permission_requests` (audit trail
 *   of who asked, who approved, when), `pending_actions` (queued retries
 *   after grant), and a richer scope dimension (once / always-for-room /
 *   always-for-agent / always-for-org). Stage A ships ONLY the minimum
 *   needed to back the `ant grant` CLI + auth-gate `no_grant` lookup so
 *   we can land the 403-payload UX win today (TODAY's substrate, no
 *   schema reshape). The row shape is byte-identical to the v0.2 schema
 *   so a Stage B migration script can `INSERT ... SELECT` rows forward.
 *
 * Auth model (Stage A — simple):
 *   The `ant grant` CLI threads the caller's pidChain into the request
 *   body; the server-side endpoint resolves caller identity and passes
 *   the resolved handle as `granted_by_handle`. Stage A does NOT check
 *   that `granted_by_handle` is actually an approver for the target —
 *   that gate lives one layer up (the endpoint declines if the caller
 *   isn't a room_owner / org_admin / plan_owner). The store itself is
 *   write-through.
 *
 * Lookup semantics:
 *   `lookupActiveGrant` returns the most recent active (un-revoked) grant
 *   row matching (grantee_handle, action, target_id) — the auth gate's
 *   `no_grant` decision is true iff this returns null.
 */

import { randomBytes } from 'node:crypto';
import { getIdentityDb } from './db';
import type { PermissionTargetKind } from './permissionDeniedPayload';

export type GrantScope = 'once' | 'always-for-room' | 'always-for-agent';

export type GrantRecord = {
  grantId: string;
  granteeHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  grantedByHandle: string;
  grantedAtMs: number;
  revokedAtMs: number | null;
  scope: GrantScope;
};

type GrantRow = {
  grant_id: string;
  grantee_handle: string;
  action: string;
  target_kind: string;
  target_id: string;
  granted_by_handle: string;
  granted_at_ms: number;
  revoked_at_ms: number | null;
  scope: string;
};

function rowToRecord(row: GrantRow): GrantRecord {
  return {
    grantId: row.grant_id,
    granteeHandle: row.grantee_handle,
    action: row.action,
    targetKind: row.target_kind as PermissionTargetKind,
    targetId: row.target_id,
    grantedByHandle: row.granted_by_handle,
    grantedAtMs: row.granted_at_ms,
    revokedAtMs: row.revoked_at_ms,
    scope: row.scope as GrantScope
  };
}

function generateGrantId(): string {
  return `gr_${randomBytes(8).toString('hex')}`;
}

function normaliseHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

export type GrantPermissionInput = {
  granteeHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  grantedByHandle: string;
  scope?: GrantScope;
  /** Override the wall-clock for tests. */
  nowMs?: number;
};

/**
 * Insert a new grant. Returns the inserted GrantRecord. Does NOT
 * deduplicate against existing rows — `ant grant` is intentionally
 * append-only so the grant history survives revoke + re-grant cycles.
 * The lookup helper picks the most recent active row.
 */
export function grantPermission(input: GrantPermissionInput): GrantRecord {
  const db = getIdentityDb();
  const grantId = generateGrantId();
  const grantedAtMs = input.nowMs ?? Date.now();
  const scope = input.scope ?? 'once';
  const granteeHandle = normaliseHandle(input.granteeHandle);
  const grantedByHandle = normaliseHandle(input.grantedByHandle);
  db.prepare(
    `INSERT INTO grants_shim
       (grant_id, grantee_handle, action, target_kind, target_id,
        granted_by_handle, granted_at_ms, revoked_at_ms, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    grantId,
    granteeHandle,
    input.action,
    input.targetKind,
    input.targetId,
    grantedByHandle,
    grantedAtMs,
    scope
  );
  return {
    grantId,
    granteeHandle,
    action: input.action,
    targetKind: input.targetKind,
    targetId: input.targetId,
    grantedByHandle,
    grantedAtMs,
    revokedAtMs: null,
    scope
  };
}

export type RevokePermissionInput = {
  granteeHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  /** Override the wall-clock for tests. */
  nowMs?: number;
};

/**
 * Soft-revoke every currently-active grant matching (grantee, action,
 * target). Returns the count of rows revoked (0 when no active grant).
 * Idempotent: re-revoking an already-revoked grant is a no-op.
 */
export function revokePermission(input: RevokePermissionInput): number {
  const db = getIdentityDb();
  const now = input.nowMs ?? Date.now();
  const granteeHandle = normaliseHandle(input.granteeHandle);
  const result = db
    .prepare(
      `UPDATE grants_shim
         SET revoked_at_ms = ?
       WHERE grantee_handle = ?
         AND action = ?
         AND target_kind = ?
         AND target_id = ?
         AND revoked_at_ms IS NULL`
    )
    .run(now, granteeHandle, input.action, input.targetKind, input.targetId);
  return result.changes;
}

export type LookupGrantInput = {
  granteeHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
};

/**
 * Return the most recent active grant for (grantee, action, target), or
 * null when no active grant exists. The auth gate's `no_grant` decision
 * inverts this — null means deny.
 */
export function lookupActiveGrant(input: LookupGrantInput): GrantRecord | null {
  const db = getIdentityDb();
  const granteeHandle = normaliseHandle(input.granteeHandle);
  const row = db
    .prepare(
      `SELECT * FROM grants_shim
        WHERE grantee_handle = ?
          AND action = ?
          AND target_kind = ?
          AND target_id = ?
          AND revoked_at_ms IS NULL
        ORDER BY granted_at_ms DESC
        LIMIT 1`
    )
    .get(granteeHandle, input.action, input.targetKind, input.targetId) as
    | GrantRow
    | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

/**
 * Test-only helper: list every grant row (active + revoked) for inspection
 * in unit + integration tests. Production callers should not need this.
 */
export function listAllGrantsForTests(): GrantRecord[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT * FROM grants_shim ORDER BY granted_at_ms ASC`)
    .all() as GrantRow[];
  return rows.map(rowToRecord);
}

/**
 * Test-only reset hook. The auto-isolated VITEST DB path (db.ts) means
 * cross-worker collisions are already mitigated, but a per-test reset
 * keeps assertions deterministic when multiple tests share the same
 * worker DB.
 */
export function resetGrantsShimForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM grants_shim`).run();
}
