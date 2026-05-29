/**
 * Seed helpers for the v0.2 regression corpus.
 *
 * Kept out of the test file so the corpus itself stays scannable — every
 * test in scripts/v0.2-regression.test.ts reads top-to-bottom as
 * "stage → attempt → assert" with one helper call per stage step.
 *
 * Spec: docs/concepts/ant-v02-identity-and-recovery.md
 * Companion: scripts/v0.2-regression.test.ts
 */

import type Database from 'better-sqlite3';

type Db = Database.Database;

/**
 * Insert a minimal v02_agents row. Returns the agent_id.
 *
 * Defaults: status='live', no primary_trust_key_id, no current_runtime_id.
 * Override fields via the optional `overrides` arg.
 */
export function seedAgent(
  db: Db,
  agentId: string,
  handle: string,
  overrides: { displayName?: string; status?: string; ownerOrg?: string | null; createdAtMs?: number } = {}
): string {
  const now = overrides.createdAtMs ?? Date.now();
  db.prepare(
    `INSERT INTO v02_agents (
       agent_id, display_name, primary_handle, status, owner_org, created_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    agentId,
    overrides.displayName ?? handle.replace(/^@/, ''),
    handle,
    overrides.status ?? 'live',
    overrides.ownerOrg ?? null,
    now
  );
  return agentId;
}

/**
 * Insert a v02_rooms row. Returns the room_id.
 */
export function seedRoom(
  db: Db,
  roomId: string,
  displayName: string,
  overrides: { visibility?: 'private' | 'org' | 'public'; ownerOrg?: string | null; createdAtMs?: number } = {}
): string {
  db.prepare(
    `INSERT INTO v02_rooms (
       room_id, display_name, owner_org, visibility, created_at_ms
     ) VALUES (?, ?, ?, ?, ?)`
  ).run(
    roomId,
    displayName,
    overrides.ownerOrg ?? null,
    overrides.visibility ?? 'private',
    overrides.createdAtMs ?? Date.now()
  );
  return roomId;
}

/**
 * Insert a v02_runtimes row. Returns the runtime_id.
 *
 * pid_start_iso defaults to a valid ISO 8601 UTC string. Pass
 * `pidStartIso: '...'` to inject malformed/locale strings deliberately.
 */
export function seedRuntime(
  db: Db,
  runtimeId: string,
  agentId: string,
  overrides: {
    host?: string;
    tmuxPane?: string | null;
    pid?: number;
    pidStartIso?: string;
    status?: 'live' | 'stale' | 'archived' | 'reclaimed';
    startedAtMs?: number;
    endedAtMs?: number | null;
    registerChallengeProof?: string;
  } = {}
): string {
  const now = overrides.startedAtMs ?? Date.now();
  db.prepare(
    `INSERT INTO v02_runtimes (
       runtime_id, agent_id, host, tmux_pane, pid, pid_start_iso, status,
       started_at_ms, ended_at_ms, register_challenge_proof
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runtimeId,
    agentId,
    overrides.host ?? 'host-a',
    overrides.tmuxPane ?? null,
    overrides.pid ?? 1000,
    overrides.pidStartIso ?? '2026-05-29T20:00:00Z',
    overrides.status ?? 'live',
    now,
    overrides.endedAtMs ?? null,
    overrides.registerChallengeProof ?? `proof-${runtimeId}`
  );
  return runtimeId;
}

/**
 * Insert a v02_memberships row. Returns the membership_id.
 */
export function seedMembership(
  db: Db,
  membershipId: string,
  agentId: string,
  roomId: string,
  overrides: {
    role?: 'owner' | 'member' | 'chair' | 'observer' | 'bot';
    roomAlias?: string | null;
    joinedAtMs?: number;
    leftAtMs?: number | null;
  } = {}
): string {
  db.prepare(
    `INSERT INTO v02_memberships (
       membership_id, agent_id, room_id, role, room_alias, joined_at_ms, left_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    membershipId,
    agentId,
    roomId,
    overrides.role ?? 'member',
    overrides.roomAlias ?? null,
    overrides.joinedAtMs ?? Date.now(),
    overrides.leftAtMs ?? null
  );
  return membershipId;
}

/**
 * Insert a v02_agent_trust_keys row. Returns the key_id.
 *
 * Defaults: device key, added via first-registration, not yet revoked,
 * not flagged primary.
 */
export function seedTrustKey(
  db: Db,
  keyId: string,
  agentId: string,
  overrides: {
    pubkey?: string;
    keyKind?: 'device' | 'recovery' | 'hardware' | 'passkey';
    deviceLabel?: string | null;
    addedAtMs?: number;
    addedVia?:
      | 'first-registration'
      | 'same-account-pairing'
      | 'super-admin-rotation'
      | 'passkey-sync'
      | 'self-rotate';
    isPrimary?: boolean;
  } = {}
): string {
  db.prepare(
    `INSERT INTO v02_agent_trust_keys (
       key_id, agent_id, pubkey, key_kind, device_label, added_at_ms, added_via, is_primary
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    keyId,
    agentId,
    overrides.pubkey ?? `ed25519-pub-${keyId}`,
    overrides.keyKind ?? 'device',
    overrides.deviceLabel ?? null,
    overrides.addedAtMs ?? Date.now(),
    overrides.addedVia ?? 'first-registration',
    overrides.isPrimary ? 1 : 0
  );
  return keyId;
}

/**
 * Revoke a trust key by writing revoked_at_ms + revoked_reason.
 * Mirrors the v0.2 spec: revoke writes to the existing row + an
 * audit_events row; no DELETE.
 */
export function revokeTrustKey(
  db: Db,
  keyId: string,
  reason:
    | 'user-rotation'
    | 'lost-device'
    | 'suspected-compromise'
    | 'super-admin-override'
    | 'expired'
    | 'superseded',
  revokedByAgentId: string | null = null,
  revokedAtMs: number = Date.now()
): void {
  db.prepare(
    `UPDATE v02_agent_trust_keys
       SET revoked_at_ms = ?, revoked_reason = ?, revoked_by_agent_id = ?
     WHERE key_id = ?`
  ).run(revokedAtMs, reason, revokedByAgentId, keyId);
}

/**
 * Count active trust keys for an agent (revoked_at_ms IS NULL).
 */
export function countActiveTrustKeys(db: Db, agentId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c
           FROM v02_agent_trust_keys
          WHERE agent_id = ? AND revoked_at_ms IS NULL`
      )
      .get(agentId) as { c: number }
  ).c;
}

/**
 * Lookup the canonical live runtime for an agent given a candidate
 * (pid, pid_start_iso). Mirrors the read-path the v0.2 cut-over server
 * will use: filter on status='live' so archived/stale rows can never
 * shadow a fresh live runtime.
 */
export function lookupLiveRuntime(
  db: Db,
  agentId: string,
  pid: number,
  pidStartIso: string,
  options: { includeArchived?: boolean } = {}
): { runtime_id: string; status: string } | null {
  const sql = options.includeArchived
    ? `SELECT runtime_id, status FROM v02_runtimes
        WHERE agent_id = ? AND pid = ? AND pid_start_iso = ?`
    : `SELECT runtime_id, status FROM v02_runtimes
        WHERE agent_id = ? AND pid = ? AND pid_start_iso = ? AND status = 'live'`;
  const row = db
    .prepare(sql)
    .get(agentId, pid, pidStartIso) as { runtime_id: string; status: string } | undefined;
  return row ?? null;
}

/**
 * Same as lookupLiveRuntime but for the includeArchived form — returns
 * all matching rows, ordered by started_at_ms DESC.
 */
export function lookupAllRuntimes(
  db: Db,
  agentId: string,
  pid: number,
  pidStartIso: string
): Array<{ runtime_id: string; status: string }> {
  return db
    .prepare(
      `SELECT runtime_id, status FROM v02_runtimes
        WHERE agent_id = ? AND pid = ? AND pid_start_iso = ?
        ORDER BY started_at_ms DESC`
    )
    .all(agentId, pid, pidStartIso) as Array<{ runtime_id: string; status: string }>;
}

/**
 * Normalise a candidate pid_start string to ISO 8601 UTC before it's
 * used in a SQL bind. Mirrors PR-A's write-side normaliser conceptually:
 * production code would call this in registerRuntime before the INSERT,
 * and in lookupRuntime before the SELECT bind. Locale strings get
 * rejected here so they can never reach the engine.
 *
 * Accepts:
 *   - ISO 8601 UTC: '2026-05-29T20:00:00Z' (passes through)
 *   - ISO with offset: '2026-05-29T20:00:00+00:00' (passes through after Date round-trip)
 *
 * Rejects (throws):
 *   - Locale strings like 'Fri May 29 20:00:00 2026' or 'Fri 29 May ...'
 *     (these are what `ps -o lstart=` returns; today's silence root cause)
 */
export function normalisePidStartIso(candidate: string): string {
  // Strict-format guard: ISO 8601 starts with YYYY-MM-DD. Locale strings
  // start with a weekday abbreviation (Mon/Tue/Wed/...). Anything that
  // doesn't match the ISO date prefix is a write-time bug.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(candidate)) {
    throw new Error(
      `pid_start must be ISO 8601 UTC (e.g. 2026-05-29T20:00:00Z); got ${JSON.stringify(candidate)}`
    );
  }
  // Round-trip through Date to canonicalise to UTC Z form.
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`pid_start is not a parseable ISO 8601 timestamp: ${JSON.stringify(candidate)}`);
  }
  return parsed.toISOString();
}
