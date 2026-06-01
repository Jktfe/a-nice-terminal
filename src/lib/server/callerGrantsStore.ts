/**
 * callerGrantsStore — JWPK msg_hf8ziydn4r + msg_zmqhwh5tpx (2026-05-19).
 *
 * Explicit grant model for the @you / @evolveant* handle spoofing class.
 * A caller whose pidChain doesn't natively resolve to a registered terminal
 * can still post as a claimed handle IFF there's an active grant row for
 * (pid, pid_start). Two kinds: 'human' (time-bounded @you grants from JWPK)
 * and 'agent' (long-lived @evolveant* grants, auto-revoked on PID exit).
 *
 * Schema in db.ts SCHEMA_DDL_STATEMENTS (commit 0caf855).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type CallerGrantKind = 'human' | 'agent';
export type CallerGrantStatus = 'active' | 'expired' | 'revoked';

export type CallerGrant = {
  id: string;
  kind: CallerGrantKind;
  pid: number;
  pidStart: string;
  handle: string;
  grantedAtMs: number;
  expiresAtMs: number | null;
  grantedByHandle: string;
  passwordVerifiedAtMs: number | null;
  tmuxSessionId: string | null;
  status: CallerGrantStatus;
};

type Row = {
  id: string;
  kind: string;
  pid: number;
  pid_start: string;
  handle: string;
  granted_at_ms: number;
  expires_at_ms: number | null;
  granted_by_handle: string;
  password_verified_at_ms: number | null;
  tmux_session_id: string | null;
  status: string;
};

function rowToGrant(row: Row): CallerGrant {
  return {
    id: row.id,
    kind: row.kind as CallerGrantKind,
    pid: row.pid,
    pidStart: row.pid_start,
    handle: row.handle,
    grantedAtMs: row.granted_at_ms,
    expiresAtMs: row.expires_at_ms,
    grantedByHandle: row.granted_by_handle,
    passwordVerifiedAtMs: row.password_verified_at_ms,
    tmuxSessionId: row.tmux_session_id,
    status: row.status as CallerGrantStatus
  };
}

/**
 * Grant @you to a specific PID for a time window. Per JWPK ratify, only
 * @you grants need an explicit expiry — agents grants don't (auto-revoked
 * when their PID exits via the sweeper below). password_verified_at_ms is
 * optional; null means the CLI ran without --password.
 */
export function grantHumanGrant(input: {
  pid: number;
  pidStart: string;
  expiresAtMs: number;
  grantedByHandle: string;
  passwordVerifiedAtMs?: number | null;
  tmuxSessionId?: string | null;
}): CallerGrant {
  const id = `grant_${randomUUID().slice(0, 16)}`;
  const nowMs = Date.now();
  const db = getIdentityDb();
  db.prepare(`INSERT INTO caller_grants
    (id, kind, pid, pid_start, handle, granted_at_ms, expires_at_ms,
     granted_by_handle, password_verified_at_ms, tmux_session_id, status)
    VALUES (?, 'human', ?, ?, '@you', ?, ?, ?, ?, ?, 'active')`).run(
    id,
    input.pid,
    input.pidStart,
    nowMs,
    input.expiresAtMs,
    input.grantedByHandle,
    input.passwordVerifiedAtMs ?? null,
    input.tmuxSessionId ?? null
  );
  const row = db.prepare(`SELECT * FROM caller_grants WHERE id = ?`).get(id) as Row;
  return rowToGrant(row);
}

/**
 * Grant an agent handle to a specific PID, no expiry. Auto-revoked when
 * the PID exits via sweepExpired(). For bring-in-external-tmux flows the
 * caller passes tmuxSessionId for pairing audit.
 */
export function grantAgentGrant(input: {
  pid: number;
  pidStart: string;
  handle: string;
  grantedByHandle: string;
  tmuxSessionId?: string | null;
}): CallerGrant {
  const id = `grant_${randomUUID().slice(0, 16)}`;
  const nowMs = Date.now();
  const db = getIdentityDb();
  db.prepare(`INSERT INTO caller_grants
    (id, kind, pid, pid_start, handle, granted_at_ms, expires_at_ms,
     granted_by_handle, password_verified_at_ms, tmux_session_id, status)
    VALUES (?, 'agent', ?, ?, ?, ?, NULL, ?, NULL, ?, 'active')`).run(
    id,
    input.pid,
    input.pidStart,
    input.handle,
    nowMs,
    input.grantedByHandle,
    input.tmuxSessionId ?? null
  );
  const row = db.prepare(`SELECT * FROM caller_grants WHERE id = ?`).get(id) as Row;
  return rowToGrant(row);
}

/**
 * Find the active grant matching (pid, pid_start, handle) — the resolver
 * the server gate calls when pidChain doesn't natively resolve.
 * Returns null if no active grant matches.
 */
export function findActiveGrantForCaller(input: {
  pid: number;
  pidStart: string;
  handle: string;
}): CallerGrant | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM caller_grants
    WHERE pid = ? AND pid_start = ? AND handle = ? AND status = 'active'
    LIMIT 1`).get(input.pid, input.pidStart, input.handle) as Row | undefined;
  if (!row) return null;
  // Lazy-expire: if the grant has an expiry and it's passed, mark expired
  // + return null. Avoids cron-sweeper races on hot paths.
  if (row.expires_at_ms !== null && row.expires_at_ms < Date.now()) {
    db.prepare(`UPDATE caller_grants SET status = 'expired' WHERE id = ?`).run(row.id);
    return null;
  }
  return rowToGrant(row);
}

/**
 * List all active grants — used by audit views.
 */
export function listActiveGrants(): CallerGrant[] {
  const db = getIdentityDb();
  const rows = db.prepare(`SELECT * FROM caller_grants
    WHERE status = 'active'
    ORDER BY granted_at_ms DESC`).all() as Row[];
  return rows.map(rowToGrant);
}

/**
 * Revoke a specific grant. Idempotent — second call returns false.
 */
export function revokeGrant(id: string): boolean {
  const db = getIdentityDb();
  const res = db.prepare(`UPDATE caller_grants
    SET status = 'revoked'
    WHERE id = ? AND status = 'active'`).run(id);
  return res.changes > 0;
}

/**
 * Background sweeper. Marks 'expired' for any active grant whose
 * expires_at_ms has passed. For agent grants (no expiry) the sweeper
 * doesn't touch them — caller can also pass a list of (pid, pidStart)
 * pairs that have exited to mark those revoked. Returns the count of
 * rows transitioned per cause.
 */
export function sweepExpired(input?: {
  exitedProcesses?: Array<{ pid: number; pidStart: string }>;
}): { expired: number; revokedByExit: number } {
  const db = getIdentityDb();
  const nowMs = Date.now();
  const expiredRes = db.prepare(`UPDATE caller_grants
    SET status = 'expired'
    WHERE status = 'active' AND expires_at_ms IS NOT NULL AND expires_at_ms < ?`).run(nowMs);
  let revokedByExit = 0;
  if (input?.exitedProcesses) {
    const stmt = db.prepare(`UPDATE caller_grants
      SET status = 'revoked'
      WHERE pid = ? AND pid_start = ? AND status = 'active'`);
    for (const proc of input.exitedProcesses) {
      const res = stmt.run(proc.pid, proc.pidStart);
      revokedByExit += Number(res.changes);
    }
  }
  return { expired: Number(expiredRes.changes), revokedByExit };
}

/**
 * Test-only: clear all rows. Tests should set ANT_FRESH_DB_PATH to a
 * tmp file so this doesn't nuke a real DB.
 */
export function resetCallerGrantsForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM caller_grants`).run();
}
