/**
 * v0.2 schema migration tests.
 *
 * Spec: docs/concepts/ant-v02-identity-and-recovery.md
 *
 * Scope: this PR ships the 11 v0.2 tables (additive — alongside the
 * legacy schema, prefixed `v02_`) and the structural invariants enforced
 * via SQLite constraints. No server code reads from these tables yet
 * (that's the cut-over PR).
 *
 * What we assert here:
 *   1. All 11 v02_ tables exist after `getIdentityDb()` runs.
 *   2. UNIQUE INDEX (agent_id) WHERE status='live' on v02_runtimes
 *      structurally rejects dual-bind: two live runtimes for the same
 *      agent_id is a constraint violation, not silent fanout drift.
 *   3. UNIQUE INDEX (agent_id, room_id) WHERE left_at_ms IS NULL on
 *      v02_memberships structurally rejects roster duplication.
 *   4. v02_memberships does NOT have a fanout_target_runtime_id column
 *      (PRAGMA table_info check). Fanout target derives from
 *      agents.current_runtime_id at send time — this column not existing
 *      is the bug fix.
 *   5. v02_agents.primary_trust_key_id is nullable AND the FK target
 *      relationship works (an agent can exist briefly with no key, then
 *      gain a primary key by FK link).
 *   6. v02_audit_events.entity_kind CHECK constraint covers all 11
 *      entity types (the 11 v0.2 entities) plus 'system'.
 *   7. Migration is IDEMPOTENT — running it twice (via
 *      resetIdentityDbForTests + getIdentityDb a second time) does not
 *      error and the table list does not change.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-schema-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

const V02_TABLES = [
  'v02_agents',
  'v02_agent_trust_keys',
  'v02_runtimes',
  'v02_rooms',
  'v02_memberships',
  'v02_tool_grants',
  'v02_permission_requests',
  'v02_pending_actions',
  'v02_reclaim_requests',
  'v02_key_rotation_requests',
  'v02_audit_events'
] as const;

const V02_ENTITY_KINDS = [
  'agent',
  'agent_trust_key',
  'runtime',
  'room',
  'membership',
  'tool_grant',
  'permission_request',
  'pending_action',
  'reclaim_request',
  'key_rotation_request',
  'system'
] as const;

describe('v0.2 schema — table creation', () => {
  it('creates all 11 v02_ tables on first getIdentityDb()', () => {
    const db = getIdentityDb();
    const tableNames = new Set(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v02_%'`)
        .all()
        .map((row) => (row as { name: string }).name)
    );
    for (const expected of V02_TABLES) {
      expect(tableNames.has(expected), `missing v02 table: ${expected}`).toBe(true);
    }
    // Exactly 11, not more not fewer.
    expect(tableNames.size).toBe(V02_TABLES.length);
  });

  it('does NOT touch existing legacy tables (terminals, room_memberships, etc.)', () => {
    const db = getIdentityDb();
    const legacyExpected = ['terminals', 'room_memberships', 'chat_rooms', 'chat_room_members'];
    const tableNames = new Set(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all()
        .map((row) => (row as { name: string }).name)
    );
    for (const expected of legacyExpected) {
      expect(tableNames.has(expected), `legacy table missing: ${expected}`).toBe(true);
    }
  });
});

describe('v0.2 schema — idempotence', () => {
  it('re-running the migration does not error and table set is unchanged', () => {
    const first = getIdentityDb();
    const firstTableSet = new Set(
      first
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v02_%'`)
        .all()
        .map((r) => (r as { name: string }).name)
    );
    resetIdentityDbForTests();
    // Second open against the SAME on-disk DB file — re-runs every DDL.
    const second = getIdentityDb();
    const secondTableSet = new Set(
      second
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v02_%'`)
        .all()
        .map((r) => (r as { name: string }).name)
    );
    expect(secondTableSet).toEqual(firstTableSet);
    expect(secondTableSet.size).toBe(V02_TABLES.length);
  });

  it('re-running the migration does not duplicate index definitions', () => {
    getIdentityDb();
    resetIdentityDbForTests();
    const second = getIdentityDb();
    const indexCount = (second
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name LIKE '%v02_%'`)
      .get() as { c: number }).c;
    // Single-pass migration → no duplicates after a second open. Exact
    // count is implementation-detail; we just want to confirm it didn't
    // double or grow unboundedly. Re-open + recount must match itself.
    resetIdentityDbForTests();
    const third = getIdentityDb();
    const indexCount2 = (third
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name LIKE '%v02_%'`)
      .get() as { c: number }).c;
    expect(indexCount2).toBe(indexCount);
  });
});

describe('v0.2 invariant — at most one live runtime per agent', () => {
  it('UNIQUE INDEX rejects a second status="live" runtime for the same agent', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-1', 'Agent One', '@one', now);
    db.prepare(`INSERT INTO v02_runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-1', 'host-a', 1234, '2026-05-29T20:00:00Z', 'live', ?, 'proof-1')`)
      .run('rt-1', now);

    expect(() =>
      db.prepare(`INSERT INTO v02_runtimes (
          runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
        ) VALUES (?, 'a-1', 'host-b', 5678, '2026-05-29T20:01:00Z', 'live', ?, 'proof-2')`)
        .run('rt-2', now)
    ).toThrow(/UNIQUE constraint failed.*v02_runtimes/);
  });

  it('allows multiple non-live runtimes for the same agent (stale/archived/reclaimed)', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-2', 'Agent Two', '@two', now);
    db.prepare(`INSERT INTO v02_runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-2', 'host-x', 1, '2026-05-29T20:00:00Z', 'stale', ?, 'p')`)
      .run('rt-3', now);
    db.prepare(`INSERT INTO v02_runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-2', 'host-y', 2, '2026-05-29T20:01:00Z', 'archived', ?, 'p')`)
      .run('rt-4', now);
    db.prepare(`INSERT INTO v02_runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-2', 'host-z', 3, '2026-05-29T20:02:00Z', 'live', ?, 'p')`)
      .run('rt-5', now);
    // No throw — three rows under the same agent are fine because only
    // one is 'live'.
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM v02_runtimes WHERE agent_id='a-2'`)
      .get() as { c: number }).c;
    expect(count).toBe(3);
  });
});

describe('v0.2 invariant — at most one active membership per (agent, room)', () => {
  it('UNIQUE INDEX rejects a second active membership for the same agent×room', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-3', 'Agent Three', '@three', now);
    db.prepare(`INSERT INTO v02_rooms (
        room_id, display_name, visibility, created_at_ms
      ) VALUES (?, ?, ?, ?)`).run('r-1', 'Room One', 'private', now);
    db.prepare(`INSERT INTO v02_memberships (
        membership_id, agent_id, room_id, role, joined_at_ms
      ) VALUES (?, 'a-3', 'r-1', 'member', ?)`).run('m-1', now);

    expect(() =>
      db.prepare(`INSERT INTO v02_memberships (
          membership_id, agent_id, room_id, role, joined_at_ms
        ) VALUES (?, 'a-3', 'r-1', 'observer', ?)`).run('m-2', now + 1000)
    ).toThrow(/UNIQUE constraint failed.*v02_memberships/);
  });

  it('allows a historical (left) membership + a fresh active one for the same agent×room', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-4', 'Agent Four', '@four', now);
    db.prepare(`INSERT INTO v02_rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-2', 'Room Two', 'org', now);
    // Old membership left at t+1s.
    db.prepare(`INSERT INTO v02_memberships (
        membership_id, agent_id, room_id, role, joined_at_ms, left_at_ms
      ) VALUES (?, 'a-4', 'r-2', 'member', ?, ?)`).run('m-3', now, now + 1000);
    // New active membership — should be allowed (left_at_ms IS NULL on
    // the new row, and the partial index ignores the left row).
    db.prepare(`INSERT INTO v02_memberships (
        membership_id, agent_id, room_id, role, joined_at_ms
      ) VALUES (?, 'a-4', 'r-2', 'observer', ?)`).run('m-4', now + 2000);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM v02_memberships
                               WHERE agent_id='a-4' AND room_id='r-2'`).get() as { c: number }).c;
    expect(count).toBe(2);
  });
});

describe('v0.2 invariant — memberships has NO fanout_target_runtime_id', () => {
  it('PRAGMA table_info(v02_memberships) does NOT include fanout_target_runtime_id', () => {
    const db = getIdentityDb();
    const cols = db.prepare(`PRAGMA table_info(v02_memberships)`).all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('fanout_target_runtime_id');
    expect(colNames).not.toContain('fanout_runtime_id');
    expect(colNames).not.toContain('cached_runtime_id');
  });

  it('v02_memberships exposes only the documented v0.2 columns', () => {
    const db = getIdentityDb();
    const cols = db.prepare(`PRAGMA table_info(v02_memberships)`).all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    // Spec §The 11 Tables, memberships row: agent×room link with
    // role/alias/joined/left/last_read. No cached runtime pointer.
    const expected = [
      'membership_id',
      'agent_id',
      'room_id',
      'role',
      'room_alias',
      'joined_at_ms',
      'left_at_ms',
      'last_read_post_order'
    ];
    for (const name of expected) {
      expect(colNames.has(name), `missing column ${name}`).toBe(true);
    }
    expect(cols.length).toBe(expected.length);
  });
});

describe('v0.2 — agents.primary_trust_key_id is nullable + FK works', () => {
  it('an agent can be inserted with primary_trust_key_id = NULL', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (
        agent_id, display_name, primary_handle, primary_trust_key_id, status, created_at_ms
      ) VALUES (?, ?, ?, NULL, 'live', ?)`).run('a-5', 'Agent Five', '@five', now);
    const row = db.prepare(`SELECT primary_trust_key_id FROM v02_agents WHERE agent_id='a-5'`)
      .get() as { primary_trust_key_id: string | null };
    expect(row.primary_trust_key_id).toBe(null);
  });

  it('an agent can be linked to a trust key via primary_trust_key_id', () => {
    const db = getIdentityDb();
    const now = Date.now();
    // Insert agent first, then a key for that agent, then update the
    // agent's primary_trust_key_id pointer. This mirrors production flow
    // — register-agent creates the row, register-key adds the first key,
    // then primary pointer flips.
    db.prepare(`INSERT INTO v02_agents (
        agent_id, display_name, primary_handle, status, created_at_ms
      ) VALUES (?, ?, ?, 'live', ?)`).run('a-6', 'Agent Six', '@six', now);
    db.prepare(`INSERT INTO v02_agent_trust_keys (
        key_id, agent_id, pubkey, key_kind, added_at_ms, is_primary
      ) VALUES (?, 'a-6', ?, 'device', ?, 1)`).run('k-1', 'ed25519-pubkey-1', now);
    db.prepare(`UPDATE v02_agents SET primary_trust_key_id='k-1' WHERE agent_id='a-6'`).run();
    const row = db.prepare(`SELECT primary_trust_key_id FROM v02_agents WHERE agent_id='a-6'`)
      .get() as { primary_trust_key_id: string };
    expect(row.primary_trust_key_id).toBe('k-1');
  });

  it('FK rejects primary_trust_key_id pointing at a non-existent key', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (
        agent_id, display_name, primary_handle, status, created_at_ms
      ) VALUES (?, ?, ?, 'live', ?)`).run('a-7', 'Agent Seven', '@seven', now);
    expect(() =>
      db.prepare(`UPDATE v02_agents SET primary_trust_key_id='nonexistent' WHERE agent_id='a-7'`).run()
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('v0.2 — audit_events.entity_kind CHECK covers all 11 entity types', () => {
  it('accepts every entity_kind listed in the spec + "system"', () => {
    const db = getIdentityDb();
    const now = Date.now();
    for (const kind of V02_ENTITY_KINDS) {
      db.prepare(`INSERT INTO v02_audit_events (
          audit_id, at_ms, kind, entity_kind, entity_id
        ) VALUES (?, ?, ?, ?, ?)`)
        .run(`ev-${kind}`, now, `${kind}.created`, kind, `entity-${kind}`);
    }
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM v02_audit_events`).get() as { c: number }).c;
    expect(count).toBe(V02_ENTITY_KINDS.length);
  });

  it('rejects an unknown entity_kind', () => {
    const db = getIdentityDb();
    const now = Date.now();
    expect(() =>
      db.prepare(`INSERT INTO v02_audit_events (
          audit_id, at_ms, kind, entity_kind, entity_id
        ) VALUES (?, ?, ?, ?, ?)`).run('ev-bad', now, 'whatever', 'unknown_kind', 'e-x')
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('v0.2 — fanout target derives from agents.current_runtime_id', () => {
  it('current_runtime_id pointer can flip without touching memberships', () => {
    // Demonstrates the structural fix: a reclaim moves the agent from
    // runtime A to runtime B by flipping agents.current_runtime_id;
    // memberships rows do NOT need updating because the fanout target
    // is derived from this pointer at send time.
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO v02_agents (
        agent_id, display_name, primary_handle, status, created_at_ms
      ) VALUES (?, ?, ?, 'live', ?)`).run('a-8', 'TigerResearch', '@tigerresearch', now);
    db.prepare(`INSERT INTO v02_rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-3', 'Tiger Room', 'private', now);
    db.prepare(`INSERT INTO v02_memberships (
        membership_id, agent_id, room_id, role, joined_at_ms
      ) VALUES (?, 'a-8', 'r-3', 'member', ?)`).run('m-5', now);
    // Runtime A on laptop.
    db.prepare(`INSERT INTO v02_runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-8', 'laptop', 100, '2026-05-29T20:00:00Z', 'live', ?, 'p-A')`)
      .run('rt-A', now);
    db.prepare(`UPDATE v02_agents SET current_runtime_id='rt-A' WHERE agent_id='a-8'`).run();
    // Laptop dies → archive runtime A.
    db.prepare(`UPDATE v02_runtimes SET status='archived', ended_at_ms=? WHERE runtime_id='rt-A'`)
      .run(now + 1000);
    db.prepare(`UPDATE v02_agents SET current_runtime_id=NULL WHERE agent_id='a-8'`).run();
    // Mini comes up → runtime B becomes live + agents pointer flips.
    db.prepare(`INSERT INTO v02_runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-8', 'macmini', 200, '2026-05-29T20:05:00Z', 'live', ?, 'p-B')`)
      .run('rt-B', now + 2000);
    db.prepare(`UPDATE v02_agents SET current_runtime_id='rt-B' WHERE agent_id='a-8'`).run();
    // Membership row is UNCHANGED — it never needed to reference any runtime.
    const memb = db.prepare(`SELECT * FROM v02_memberships WHERE membership_id='m-5'`)
      .get() as Record<string, unknown>;
    expect(memb.agent_id).toBe('a-8');
    expect(memb.room_id).toBe('r-3');
    // No fanout-runtime column exists to drift.
    expect('fanout_target_runtime_id' in memb).toBe(false);
    // Send-time fanout query (the production code will use this shape):
    const fanoutTarget = db.prepare(
      `SELECT a.current_runtime_id AS rt
         FROM v02_memberships m
         JOIN v02_agents a ON a.agent_id = m.agent_id
         WHERE m.room_id = ? AND m.left_at_ms IS NULL`
    ).all('r-3') as { rt: string | null }[];
    expect(fanoutTarget).toEqual([{ rt: 'rt-B' }]);
  });
});
