/**
 * v02RuntimesStore — ephemeral pane/shell binding entity for v0.2.
 *
 * Schema (see ./db.ts V02_SCHEMA_DDL_STATEMENTS):
 *   runtimes(runtime_id, agent_id, host, tmux_pane?, pid,
 *                pid_start_iso, cli_provider_id?, status,
 *                started_at_ms, last_heartbeat_ms?, ended_at_ms?,
 *                reclaimed_by_runtime_id?, register_challenge_proof)
 *
 * Replaces the LEGACY `terminals` table for ephemeral pane state. The
 * crucial structural difference:
 *
 *   UNIQUE INDEX uq_runtimes_agent_live
 *     ON runtimes (agent_id) WHERE status='live'
 *
 * An agent can have AT MOST ONE live runtime. Attempting to insert a
 * second live runtime for the same agent_id raises SQLITE_CONSTRAINT
 * instead of silently dual-binding. This is the structural fix for the
 * dual-bind race that ran 4× on 2026-05-29 — see v0.2 spec §Three
 * Structural Invariants #1.
 *
 * pid_start_iso must be ISO 8601 UTC (e.g. "2026-05-29T20:00:00Z"). The
 * legacy `pid_start` column stored locale-dependent strings from `ps -o
 * lstart=` which compared unequally across locale changes; the v0.2
 * format normalises this so the same shell at the same start time
 * compares equal everywhere.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import * as v02Agents from './v02AgentsStore';

export type V02RuntimeStatus = 'live' | 'stale' | 'archived' | 'reclaimed';

export type V02RuntimeRow = {
  runtime_id: string;
  agent_id: string;
  host: string;
  tmux_pane: string | null;
  pid: number;
  pid_start_iso: string;
  cli_provider_id: string | null;
  status: V02RuntimeStatus;
  started_at_ms: number;
  last_heartbeat_ms: number | null;
  ended_at_ms: number | null;
  reclaimed_by_runtime_id: string | null;
  register_challenge_proof: string;
};

export type RegisterRuntimeInput = {
  agent_id: string;
  host: string;
  pid: number;
  pid_start_iso: string;
  tmux_pane?: string | null;
  cli_provider_id?: string | null;
  register_challenge_proof: string;
};

export type PidChainEntry = {
  pid: number;
  pid_start_iso: string | null;
};

/**
 * Insert a new live runtime row. Will throw SQLITE_CONSTRAINT_UNIQUE if
 * another live runtime for the same agent_id exists — callers MUST first
 * archive the old runtime (via {@link setRuntimeStatus}) or use
 * {@link reclaimRuntime} for the atomic swap path.
 *
 * Mirrors `terminalsStore.upsertTerminal` but uses agent_id as the
 * canonical FK (terminals used `name` which is a soft identifier).
 */
export function registerRuntime(input: RegisterRuntimeInput): V02RuntimeRow {
  const db = getIdentityDb();
  const runtime_id = randomUUID();
  const now_ms = Date.now();
  db.prepare(
    `INSERT INTO runtimes
       (runtime_id, agent_id, host, tmux_pane, pid, pid_start_iso,
        cli_provider_id, status, started_at_ms, last_heartbeat_ms,
        ended_at_ms, reclaimed_by_runtime_id, register_challenge_proof)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, NULL, NULL, ?)`
  ).run(
    runtime_id,
    input.agent_id,
    input.host,
    input.tmux_pane ?? null,
    input.pid,
    input.pid_start_iso,
    input.cli_provider_id ?? null,
    now_ms,
    now_ms,
    input.register_challenge_proof
  );
  // Flip agents.current_runtime_id pointer — fanout reads this.
  v02Agents.setCurrentRuntimeId(input.agent_id, runtime_id);
  return getRuntimeById(runtime_id) as V02RuntimeRow;
}

export function getRuntimeById(runtime_id: string): V02RuntimeRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM runtimes WHERE runtime_id = ?`)
    .get(runtime_id) as V02RuntimeRow | undefined;
  return row ?? null;
}

/**
 * Get the live runtime for an agent, or null if none. Returns at most
 * one row due to the UNIQUE-WHERE-LIVE index — this is enforced at the
 * DB layer, not application-level.
 */
export function getLiveRuntimeForAgent(agent_id: string): V02RuntimeRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT * FROM runtimes
        WHERE agent_id = ? AND status = 'live'
        LIMIT 1`
    )
    .get(agent_id) as V02RuntimeRow | undefined;
  return row ?? null;
}

export function listRuntimesForAgent(agent_id: string): V02RuntimeRow[] {
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT * FROM runtimes
        WHERE agent_id = ?
        ORDER BY started_at_ms DESC`
    )
    .all(agent_id) as V02RuntimeRow[];
}

export function listAllRuntimes(): V02RuntimeRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM runtimes ORDER BY started_at_ms DESC`)
    .all() as V02RuntimeRow[];
}

export function listLiveRuntimes(): V02RuntimeRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM runtimes WHERE status = 'live' ORDER BY started_at_ms DESC`)
    .all() as V02RuntimeRow[];
}

/**
 * Walk the caller's PID chain (parent-first) and return the most recent
 * live runtime matching (pid, pid_start_iso). Used by the auth gate to
 * resolve a calling shell to its bound runtime.
 *
 * pid_start_iso === null in the entry acts as a wildcard match against
 * any pid_start (mirrors legacy `lookupTerminalByPidChain` semantics for
 * older clients that didn't send pid_start).
 *
 * Returns null when no entry resolves (orphaned shell / no register
 * happened) — the gate falls back to other identity paths.
 */
export function lookupRuntimeByPidChain(
  pidChain: PidChainEntry[]
): V02RuntimeRow | null {
  if (pidChain.length === 0) return null;
  const db = getIdentityDb();
  const stmt = db.prepare(
    `SELECT * FROM runtimes
      WHERE pid = ? AND (? IS NULL OR pid_start_iso = ?)
        AND status = 'live'
      ORDER BY started_at_ms DESC
      LIMIT 1`
  );
  for (const entry of pidChain) {
    const row = stmt.get(entry.pid, entry.pid_start_iso, entry.pid_start_iso) as
      | V02RuntimeRow
      | undefined;
    if (row) return row;
  }
  return null;
}

/**
 * Set a runtime's status. Idempotent.
 *
 * When flipping FROM 'live' TO any non-live state, ALSO clears
 * agents.current_runtime_id if it pointed at this runtime — keeps
 * the fanout invariant tight (no pointer at a non-live runtime). Use
 * {@link reclaimRuntime} for the atomic swap path instead when there's a
 * replacement runtime to point to.
 */
export function setRuntimeStatus(
  runtime_id: string,
  status: V02RuntimeStatus
): boolean {
  const db = getIdentityDb();
  const row = getRuntimeById(runtime_id);
  if (!row) return false;
  const now_ms = Date.now();
  const ended_at_ms = status === 'live' ? null : now_ms;
  const info = db
    .prepare(
      `UPDATE runtimes
          SET status = ?, ended_at_ms = COALESCE(ended_at_ms, ?)
        WHERE runtime_id = ?`
    )
    .run(status, ended_at_ms, runtime_id);
  // If we just flipped from live → not-live, clear the agent pointer iff
  // it was still pointing at us.
  if (info.changes > 0 && row.status === 'live' && status !== 'live') {
    const agent = v02Agents.getAgentById(row.agent_id);
    if (agent && agent.current_runtime_id === runtime_id) {
      v02Agents.setCurrentRuntimeId(row.agent_id, null);
    }
  }
  return info.changes > 0;
}

/**
 * Atomic swap: flip the old runtime to 'reclaimed' + register a NEW live
 * runtime + flip agents.current_runtime_id pointer in one transaction.
 * Used by the super-admin reclaim flow + auto-rebind on register-with-
 * existing-agent.
 *
 * Returns the new runtime row. Throws on FK / UNIQUE violations — callers
 * should treat this as the source of truth for "did the swap land".
 */
export function reclaimRuntime(input: {
  old_runtime_id: string;
  new_runtime_input: RegisterRuntimeInput;
}): V02RuntimeRow {
  const db = getIdentityDb();
  const tx = db.transaction(() => {
    const old = getRuntimeById(input.old_runtime_id);
    if (!old) throw new Error(`reclaimRuntime: old runtime ${input.old_runtime_id} not found`);
    if (old.agent_id !== input.new_runtime_input.agent_id) {
      throw new Error(
        `reclaimRuntime: agent_id mismatch — old runtime belongs to ${old.agent_id}, new is for ${input.new_runtime_input.agent_id}`
      );
    }
    // Flip old runtime out of 'live' BEFORE inserting new live runtime so
    // the UNIQUE-WHERE-LIVE index doesn't reject the insert.
    const now_ms = Date.now();
    db.prepare(
      `UPDATE runtimes
          SET status = 'reclaimed', ended_at_ms = ?
        WHERE runtime_id = ?`
    ).run(now_ms, input.old_runtime_id);
    const new_runtime_id = randomUUID();
    db.prepare(
      `INSERT INTO runtimes
         (runtime_id, agent_id, host, tmux_pane, pid, pid_start_iso,
          cli_provider_id, status, started_at_ms, last_heartbeat_ms,
          ended_at_ms, reclaimed_by_runtime_id, register_challenge_proof)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, NULL, NULL, ?)`
    ).run(
      new_runtime_id,
      input.new_runtime_input.agent_id,
      input.new_runtime_input.host,
      input.new_runtime_input.tmux_pane ?? null,
      input.new_runtime_input.pid,
      input.new_runtime_input.pid_start_iso,
      input.new_runtime_input.cli_provider_id ?? null,
      now_ms,
      now_ms,
      input.new_runtime_input.register_challenge_proof
    );
    // Back-link the old runtime to point at the new (audit trail).
    db.prepare(
      `UPDATE runtimes SET reclaimed_by_runtime_id = ? WHERE runtime_id = ?`
    ).run(new_runtime_id, input.old_runtime_id);
    // Flip agents pointer + bump reclaim_count.
    v02Agents.setCurrentRuntimeId(input.new_runtime_input.agent_id, new_runtime_id);
    v02Agents.incrementReclaimCount(input.new_runtime_input.agent_id);
    return new_runtime_id;
  });
  const new_runtime_id = tx();
  return getRuntimeById(new_runtime_id) as V02RuntimeRow;
}

/**
 * Update last_heartbeat_ms. Best-effort + idempotent. Called by the
 * agentStatusPoller every tick on every live runtime.
 */
export function touchHeartbeat(
  runtime_id: string,
  now_ms: number = Date.now()
): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE runtimes SET last_heartbeat_ms = ? WHERE runtime_id = ?`)
    .run(now_ms, runtime_id);
  return info.changes > 0;
}

/**
 * Sweep runtimes whose last_heartbeat_ms is older than `stale_after_ms`.
 * Flips status to 'stale' (NOT 'archived' — stale runtimes are
 * recoverable via reclaim; archived requires explicit operator action).
 * Returns the count of flipped rows.
 */
export function sweepStaleRuntimes(stale_after_ms: number = 5 * 60 * 1000): number {
  const db = getIdentityDb();
  const threshold = Date.now() - stale_after_ms;
  const rows = db
    .prepare(
      `SELECT runtime_id FROM runtimes
        WHERE status = 'live'
          AND last_heartbeat_ms IS NOT NULL
          AND last_heartbeat_ms < ?`
    )
    .all(threshold) as { runtime_id: string }[];
  let flipped = 0;
  for (const { runtime_id } of rows) {
    if (setRuntimeStatus(runtime_id, 'stale')) flipped += 1;
  }
  return flipped;
}
