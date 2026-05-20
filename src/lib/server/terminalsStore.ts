/**
 * terminalsStore — the operator-named terminal entity per PTY-INJECT-0 v2 doc Q3.
 *
 * Schema (see ./db.ts):
 *   terminals(id, pid, pid_start, name, tmux_target_pane?, agent_kind?,
 *             pane_status, pane_stale_since?, source, expires_at?, meta,
 *             created_at, updated_at)
 *
 * In A-scope: only pid + pid_start + name + source + ttl are used. The
 * pane/agent_kind/status columns exist for B's tmux fanout but stay null
 * until then. No injection logic lives here.
 *
 * Identity lookup walks the caller's PID chain and picks the MOST RECENT
 * matching (pid, pid_start) row. pid_start is the opaque `ps -o lstart=`
 * string from v3; we preserve it verbatim, never parse it.
 */

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getIdentityDb } from './db';
import { projectAntRegistryFileBestEffort } from './antRegistryFile';
import type { TerminalRecord } from './terminalRecordsStore';

export type TerminalRow = {
  id: string;
  pid: number;
  pid_start: string | null;
  name: string;
  tmux_target_pane: string | null;
  agent_kind: string | null;
  pane_status: 'unknown' | 'verified' | 'stale';
  pane_stale_since: number | null;
  source: string;
  expires_at: number | null;
  meta: string;
  created_at: number;
  updated_at: number;
  // M3.4a-v2 columns (added in T1). Older rows return null until first touch.
  agent_status?: 'idle' | 'thinking' | 'working' | 'response-required';
  agent_status_source?: 'fingerprint' | 'hook' | 'ant-activity' | 'pid-cpu' | 'default';
  agent_status_at_ms?: number;
  last_fingerprint_hash?: string | null;
  last_fingerprint_at_ms?: number | null;
  last_message_sent_at_ms?: number | null;
  last_pty_byte_at_ms?: number | null;
};

export type RegisterTerminalInput = {
  pid: number;
  pid_start: string | null;
  name: string;
  source?: string;
  ttlSeconds?: number;
  meta?: Record<string, unknown>;
};

export type PidChainEntry = {
  pid: number;
  pid_start: string | null;
};

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

function clampTtlSeconds(rawTtl: number | undefined): number {
  const ttl = typeof rawTtl === 'number' && Number.isFinite(rawTtl)
    ? Math.floor(rawTtl)
    : DEFAULT_TTL_SECONDS;
  if (ttl < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS) return MAX_TTL_SECONDS;
  return ttl;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * AUTO-REGISTER-AT-SPAWN (2026-05-16, JWPK T1 self-post fix):
 *
 * When ANT spawns a terminal via POST /api/terminals, the daemon
 * launches a shell inside a tmux pane but no `terminals` row is
 * created — that row is normally created by `ant register` from
 * INSIDE the shell. If the user never runs ant register (typical
 * for ANT-spawned terminals), the pidChain identity resolution
 * fails and the terminal cannot post to its OWN linked chat room
 * (the FINDING-3 LINKEDCHAT-SELF-HANDLE path needs a terminals row
 * whose id matches the linked terminal_records.session_id).
 *
 * This helper queries tmux for the pane's shell PID, reads
 * `ps -o lstart=` for pid_start stability, and INSERTs a terminals
 * row with id = sessionId so identityGate can resolve the caller
 * directly.
 *
 * Safe to call multiple times — uses INSERT OR REPLACE keyed by id.
 * Returns the registered row, or null if tmux didn't have the pane
 * (e.g. daemon spawn failed and the pane never existed).
 */
export function autoRegisterTerminalForSpawnedSession(input: {
  sessionId: string;
  tmuxTargetPane: string;
  agentKind?: string | null;
}): TerminalRow | null {
  let panePid: number;
  try {
    const out = execFileSync(
      'tmux',
      ['display-message', '-p', '-t', input.tmuxTargetPane, '#{pane_pid}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    panePid = Number(out);
    if (!Number.isFinite(panePid) || panePid <= 0) return null;
  } catch {
    // tmux not available, pane doesn't exist, or daemon spawn lost — bail.
    return null;
  }

  let pidStart: string | null = null;
  try {
    pidStart = execFileSync(
      'ps',
      ['-o', 'lstart=', '-p', String(panePid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim() || null;
  } catch {
    // ps failed (process died?). Leaving pid_start null is acceptable —
    // lookupTerminalByPidChain treats null as a wildcard match.
  }

  const db = getIdentityDb();
  const now = currentUnixSeconds();
  // Long TTL: this row IS the ANT-spawned terminal — it shouldn't expire
  // just because nobody ran `ant register` from inside the shell.
  const expiresAt = now + 30 * 24 * 60 * 60;
  const metaJson = JSON.stringify({ origin: 'spawn-auto' });

  db.prepare(`INSERT OR REPLACE INTO terminals
    (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
     source, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'spawn-auto', ?, ?, ?, ?)`).run(
    input.sessionId,
    panePid,
    pidStart,
    `auto:${input.sessionId}`,
    input.tmuxTargetPane,
    input.agentKind ?? null,
    expiresAt,
    metaJson,
    now,
    now
  );

  projectAntRegistryFileBestEffort();
  return getTerminalById(input.sessionId);
}

export function adoptExternalProcessForTerminal(input: {
  record: TerminalRecord;
  pid: number;
  pidStart: string | null;
  ttlSeconds: number;
  reason?: string | null;
  adoptedBy?: string | null;
}): TerminalRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const expiresAt = now + clampTtlSeconds(input.ttlSeconds);
  const metaJson = JSON.stringify({
    origin: 'adopt',
    reason: input.reason ?? null,
    adoptedBy: input.adoptedBy ?? null,
    adoptedAt: now
  });

  db.prepare(`INSERT INTO terminals
    (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
     source, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'adopt', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      pid = excluded.pid,
      pid_start = excluded.pid_start,
      name = excluded.name,
      tmux_target_pane = excluded.tmux_target_pane,
      agent_kind = excluded.agent_kind,
      pane_status = 'unknown',
      pane_stale_since = NULL,
      source = excluded.source,
      expires_at = excluded.expires_at,
      meta = excluded.meta,
      updated_at = excluded.updated_at`).run(
    input.record.session_id,
    input.pid,
    input.pidStart,
    input.record.name,
    input.record.tmux_target_pane,
    input.record.agent_kind,
    expiresAt,
    metaJson,
    now,
    now
  );

  projectAntRegistryFileBestEffort();
  const row = getTerminalById(input.record.session_id);
  if (!row) throw new Error('adoptExternalProcessForTerminal: row not found after upsert.');
  return row;
}

export function upsertTerminal(input: RegisterTerminalInput): TerminalRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const ttl = clampTtlSeconds(input.ttlSeconds);
  const expiresAt = now + ttl;
  const sourceLabel = input.source ?? 'cli-register';
  const metaJson = JSON.stringify(input.meta ?? {});

  const existingByName = db
    .prepare(`SELECT id FROM terminals WHERE name = ?`)
    .get(input.name) as { id: string } | undefined;

  if (existingByName) {
    db.prepare(`UPDATE terminals SET
      pid = ?, pid_start = ?, source = ?, expires_at = ?, meta = ?, updated_at = ?
      WHERE id = ?`).run(
      input.pid, input.pid_start, sourceLabel, expiresAt, metaJson, now, existingByName.id
    );
    projectAntRegistryFileBestEffort();
    return getTerminalById(existingByName.id) as TerminalRow;
  }

  const newId = randomUUID();
  db.prepare(`INSERT INTO terminals
    (id, pid, pid_start, name, source, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newId, input.pid, input.pid_start, input.name, sourceLabel, expiresAt, metaJson, now, now
  );
  projectAntRegistryFileBestEffort();
  return getTerminalById(newId) as TerminalRow;
}

export function getTerminalById(id: string): TerminalRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM terminals WHERE id = ?`).get(id) as TerminalRow | undefined;
  return row ?? null;
}

export function getTerminalByName(name: string): TerminalRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM terminals WHERE name = ?`).get(name) as TerminalRow | undefined;
  return row ?? null;
}

export function lookupTerminalByPidChain(pidChain: PidChainEntry[]): TerminalRow | null {
  if (pidChain.length === 0) return null;
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const findMostRecent = db.prepare(
    `SELECT * FROM terminals
     WHERE pid = ? AND (pid_start IS NULL OR pid_start = ?)
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY updated_at DESC LIMIT 1`
  );
  for (const entry of pidChain) {
    const row = findMostRecent.get(entry.pid, entry.pid_start, now) as TerminalRow | undefined;
    if (row) return row;
  }
  return null;
}

export function listAllTerminals(): TerminalRow[] {
  const db = getIdentityDb();
  return db.prepare(`SELECT * FROM terminals ORDER BY updated_at DESC`).all() as TerminalRow[];
}

export function deleteTerminalById(id: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM terminals WHERE id = ?`).run(id);
  if (info.changes > 0) projectAntRegistryFileBestEffort();
  return info.changes > 0;
}

export function sweepExpiredTerminals(): number {
  const db = getIdentityDb();
  const info = db
    .prepare(`DELETE FROM terminals WHERE expires_at IS NOT NULL AND expires_at <= ?`)
    .run(currentUnixSeconds());
  if (info.changes > 0) projectAntRegistryFileBestEffort();
  return info.changes;
}

export function updatePaneTarget(
  terminalId: string,
  pane: string,
  agentKind: string | null
): boolean {
  const db = getIdentityDb();
  const info = db.prepare(
    `UPDATE terminals
     SET tmux_target_pane = ?, agent_kind = ?, pane_status = 'unknown',
         pane_stale_since = NULL, updated_at = ?
     WHERE id = ?`
  ).run(pane, agentKind, currentUnixSeconds(), terminalId);
  if (info.changes > 0) projectAntRegistryFileBestEffort();
  return info.changes > 0;
}

export function markPaneVerified(terminalId: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(
    `UPDATE terminals
     SET pane_status = 'verified', pane_stale_since = NULL, updated_at = ?
     WHERE id = ?`
  ).run(currentUnixSeconds(), terminalId);
  return info.changes > 0;
}

export function markPaneStale(terminalId: string): boolean {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const info = db.prepare(
    `UPDATE terminals
     SET pane_status = 'stale', pane_stale_since = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, terminalId);
  return info.changes > 0;
}

/**
 * M3.4a-v2 T3d Q5 touchpoint: bump last_message_sent_at_ms when this terminal
 * authors a chat message. Best-effort — failures swallowed so the chat write
 * path is never blocked by an agent-status side effect.
 */
export function touchLastMessageSentAt(terminalId: string, nowMs: number = Date.now()): boolean {
  try {
    const db = getIdentityDb();
    const info = db.prepare(
      `UPDATE terminals SET last_message_sent_at_ms = ? WHERE id = ?`
    ).run(nowMs, terminalId);
    // #117 fix: stamp agent_status='working' too so the room footer
    // sees the agent as active for the next sampling window. Only
    // overrides lower-priority sources (pid-cpu / default) — fingerprint
    // and hook keep their authority per the M3.4a-v2 cascade.
    db.prepare(
      `UPDATE terminals
          SET agent_status = 'working',
              agent_status_source = 'ant-activity',
              agent_status_at_ms = ?
        WHERE id = ?
          AND agent_status_source IN ('pid-cpu', 'default', 'ant-activity')`
    ).run(nowMs, terminalId);
    return info.changes > 0;
  } catch {
    return false;
  }
}

/**
 * M3.4a-v2 T3d Q5 touchpoint: bump last_pty_byte_at_ms when the fanout
 * successfully enqueues bytes for this terminal's pane. Best-effort — failures
 * swallowed so the fanout path is never blocked.
 */
export function touchLastPtyByteAt(terminalId: string, nowMs: number = Date.now()): boolean {
  try {
    const db = getIdentityDb();
    const info = db.prepare(
      `UPDATE terminals SET last_pty_byte_at_ms = ? WHERE id = ?`
    ).run(nowMs, terminalId);
    return info.changes > 0;
  } catch {
    return false;
  }
}

/**
 * Per-CLI fingerprint probe writes context-fill (0..1) here. agent-statuses
 * reads it under a 5-minute freshness window — anything older surfaces as
 * "unknown" so the chip doesn't show stuck percentages when an agent dies
 * or stalls. JWPK msg_vz19pvkajk 2026-05-19.
 */
export function setAgentContextFill(
  terminalId: string,
  fill: number,
  source: string,
  nowMs: number = Date.now()
): boolean {
  if (!Number.isFinite(fill) || fill < 0 || fill > 1) return false;
  try {
    const db = getIdentityDb();
    const info = db.prepare(
      `UPDATE terminals
         SET agent_context_fill = ?,
             agent_context_fill_source = ?,
             agent_context_fill_at_ms = ?
       WHERE id = ?`
    ).run(fill, source, nowMs, terminalId);
    return info.changes > 0;
  } catch {
    return false;
  }
}
