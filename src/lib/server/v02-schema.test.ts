/**
 * v0.2 schema migration tests.
 *
 * Spec: docs/concepts/ant-v02-identity-and-recovery.md
 * Option D collapse: docs/concepts/ant-v02-option-d-collapse-plan.md
 *
 * Scope: this PR ships the v0.2 substrate tables OWNED by the schema
 * stream. Sibling Option D PRs own their own substrate tables:
 *   - PR #99 owns identities / identity_keys / identity_attestations / recovery_grants
 *   - PR #105 owns permission_requests / pending_actions
 *   - PR #106 owns reclaim_requests
 *
 * This file's scope: agents / runtimes / rooms / memberships / tool_grants
 * / audit_events / user_room_preferences / user_panel_pins — 8 tables (no
 * `v02_` prefix per Option D collapse since archive-and-ditch eliminates
 * the migration window).
 *
 * What we assert here:
 *   1. All 8 v0.2 tables this PR owns exist after `getIdentityDb()` runs.
 *   2. UNIQUE INDEX (agent_id) WHERE status='live' on runtimes
 *      structurally rejects dual-bind: two live runtimes for the same
 *      agent_id is a constraint violation, not silent fanout drift.
 *   3. UNIQUE INDEX (agent_id, room_id) WHERE left_at_ms IS NULL on
 *      memberships structurally rejects roster duplication.
 *   4. memberships does NOT have a fanout_target_runtime_id column
 *      (PRAGMA table_info check). Fanout target derives from
 *      agents.current_runtime_id at send time — this column not existing
 *      is the bug fix.
 *   5. agents.primary_trust_key_id is nullable AND targets PR #99's
 *      identity_keys(key_id) (Option D collapse).
 *   6. audit_events.entity_kind CHECK constraint covers all v0.2 entity
 *      types (owned-here + sibling-PR-owned) plus 'system'.
 *   7. user_room_preferences enforces UNIQUE(user_agent_id, room_id).
 *   8. user_panel_pins enforces UNIQUE(user_agent_id, entity_kind,
 *      entity_id) WHERE unpinned_at_ms IS NULL — soft-unpin permits
 *      re-pin without constraint violation.
 *   9. Migration is IDEMPOTENT — running it twice (via
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

/**
 * Sibling Option D substrate PRs (#99 identity_keys, #105 permission_requests,
 * #106 reclaim_requests) own their own DDL in SCHEMA_DDL_STATEMENTS. This
 * isolated test branch doesn't carry those PRs' diffs, but our v0.2 owned
 * tables (agents, tool_grants) reference them via FK. Seed the minimal
 * skeletons here so the FK targets exist; production migration runs the
 * sibling PRs' real DDL first.
 *
 * Once PR #99/#105/#106 land on dev and PR #103 rebases on dev, this
 * fixture becomes a no-op (CREATE TABLE IF NOT EXISTS is idempotent).
 */
function seedSiblingFkTargets(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      identity_id        TEXT PRIMARY KEY,
      kind               TEXT NOT NULL,
      display_name       TEXT NOT NULL,
      canonical_handle   TEXT NOT NULL,
      created_at_ms      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_keys (
      key_id        TEXT PRIMARY KEY,
      identity_id   TEXT NOT NULL REFERENCES identities(identity_id),
      device_label  TEXT NOT NULL,
      public_key    TEXT NOT NULL,
      key_kind      TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS permission_requests (
      request_id   TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reclaim_requests (
      request_id   TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL
    );
  `);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-schema-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
  // Seed sibling-PR FK target tables so the FKs in our DDL resolve in
  // this branch's isolated test run. Once #99/#105/#106 land on dev and
  // we rebase, those PRs' real DDL will seed these tables first and our
  // CREATE TABLE IF NOT EXISTS in the fixture becomes a no-op.
  seedSiblingFkTargets(getIdentityDb());
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

// Tables owned by THIS PR's V02_SCHEMA_DDL_STATEMENTS after Option D
// collapse. Sibling-PR-owned tables (identity_keys, permission_requests,
// reclaim_requests, etc.) are tested by their owning PR's test files.
const V02_OWNED_TABLES = [
  'agents',
  'runtimes',
  'rooms',
  'memberships',
  'tool_grants',
  'audit_events',
  'user_room_preferences',
  'user_panel_pins'
] as const;

const V02_ENTITY_KINDS = [
  // owned by THIS PR
  'agent',
  'runtime',
  'room',
  'membership',
  'tool_grant',
  'user_room_preference',
  'user_panel_pin',
  // owned by PR #99 (identity stream)
  'identity',
  'identity_key',
  'recovery_grant',
  // owned by PR #105 (permission_requests stream)
  'permission_request',
  'pending_action',
  // owned by PR #106 (reclaim stream)
  'reclaim_request',
  // catch-all
  'system'
] as const;

describe('v0.2 schema — owned table creation', () => {
  it('creates all v0.2 tables owned by this PR on first getIdentityDb()', () => {
    const db = getIdentityDb();
    const tableNames = new Set(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all()
        .map((row) => (row as { name: string }).name)
    );
    for (const expected of V02_OWNED_TABLES) {
      expect(tableNames.has(expected), `missing v0.2 owned table: ${expected}`).toBe(true);
    }
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

  it('does NOT create any v02_-prefixed tables (Option D collapse)', () => {
    const db = getIdentityDb();
    const v02PrefixedCount = (db
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name LIKE 'v02_%'`)
      .get() as { c: number }).c;
    expect(v02PrefixedCount).toBe(0);
  });
});

describe('v0.2 schema — idempotence', () => {
  it('re-running the migration does not error and owned-table set is unchanged', () => {
    getIdentityDb();
    const firstTableSet = new Set(
      getIdentityDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all()
        .map((r) => (r as { name: string }).name)
    );
    resetIdentityDbForTests();
    const second = getIdentityDb();
    const secondTableSet = new Set(
      second
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all()
        .map((r) => (r as { name: string }).name)
    );
    expect(secondTableSet).toEqual(firstTableSet);
    for (const expected of V02_OWNED_TABLES) {
      expect(secondTableSet.has(expected)).toBe(true);
    }
  });

  it('re-running the migration does not duplicate v0.2 indexes', () => {
    getIdentityDb();
    resetIdentityDbForTests();
    const second = getIdentityDb();
    // Indexes specifically for the tables we own.
    const indexCount = (second
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index'
                AND (name LIKE 'idx_agents%' OR name LIKE 'idx_runtimes%' OR name LIKE 'idx_rooms%'
                  OR name LIKE 'idx_memberships%' OR name LIKE 'idx_tool_grants%'
                  OR name LIKE 'idx_audit_events%' OR name LIKE 'uq_runtimes%'
                  OR name LIKE 'uq_memberships%' OR name LIKE 'uq_user_room_preferences%'
                  OR name LIKE 'uq_user_panel_pins%')`)
      .get() as { c: number }).c;
    resetIdentityDbForTests();
    const third = getIdentityDb();
    const indexCount2 = (third
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index'
                AND (name LIKE 'idx_agents%' OR name LIKE 'idx_runtimes%' OR name LIKE 'idx_rooms%'
                  OR name LIKE 'idx_memberships%' OR name LIKE 'idx_tool_grants%'
                  OR name LIKE 'idx_audit_events%' OR name LIKE 'uq_runtimes%'
                  OR name LIKE 'uq_memberships%' OR name LIKE 'uq_user_room_preferences%'
                  OR name LIKE 'uq_user_panel_pins%')`)
      .get() as { c: number }).c;
    expect(indexCount2).toBe(indexCount);
  });
});

describe('v0.2 invariant — at most one live runtime per agent', () => {
  it('UNIQUE INDEX rejects a second status="live" runtime for the same agent', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-1', 'Agent One', '@one', now);
    db.prepare(`INSERT INTO runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-1', 'host-a', 1234, '2026-05-29T20:00:00Z', 'live', ?, 'proof-1')`)
      .run('rt-1', now);

    expect(() =>
      db.prepare(`INSERT INTO runtimes (
          runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
        ) VALUES (?, 'a-1', 'host-b', 5678, '2026-05-29T20:01:00Z', 'live', ?, 'proof-2')`)
        .run('rt-2', now)
    ).toThrow(/UNIQUE constraint failed.*runtimes/);
  });

  it('allows multiple non-live runtimes for the same agent (stale/archived/reclaimed)', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-2', 'Agent Two', '@two', now);
    db.prepare(`INSERT INTO runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-2', 'host-x', 1, '2026-05-29T20:00:00Z', 'stale', ?, 'p')`)
      .run('rt-3', now);
    db.prepare(`INSERT INTO runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-2', 'host-y', 2, '2026-05-29T20:01:00Z', 'archived', ?, 'p')`)
      .run('rt-4', now);
    db.prepare(`INSERT INTO runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-2', 'host-z', 3, '2026-05-29T20:02:00Z', 'live', ?, 'p')`)
      .run('rt-5', now);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM runtimes WHERE agent_id='a-2'`)
      .get() as { c: number }).c;
    expect(count).toBe(3);
  });
});

describe('v0.2 invariant — at most one active membership per (agent, room)', () => {
  it('UNIQUE INDEX rejects a second active membership for the same agent×room', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-3', 'Agent Three', '@three', now);
    db.prepare(`INSERT INTO rooms (
        room_id, display_name, visibility, created_at_ms
      ) VALUES (?, ?, ?, ?)`).run('r-1', 'Room One', 'private', now);
    db.prepare(`INSERT INTO memberships (
        membership_id, agent_id, room_id, role, joined_at_ms
      ) VALUES (?, 'a-3', 'r-1', 'member', ?)`).run('m-1', now);

    expect(() =>
      db.prepare(`INSERT INTO memberships (
          membership_id, agent_id, room_id, role, joined_at_ms
        ) VALUES (?, 'a-3', 'r-1', 'observer', ?)`).run('m-2', now + 1000)
    ).toThrow(/UNIQUE constraint failed.*memberships/);
  });

  it('allows a historical (left) membership + a fresh active one for the same agent×room', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('a-4', 'Agent Four', '@four', now);
    db.prepare(`INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-2', 'Room Two', 'org', now);
    db.prepare(`INSERT INTO memberships (
        membership_id, agent_id, room_id, role, joined_at_ms, left_at_ms
      ) VALUES (?, 'a-4', 'r-2', 'member', ?, ?)`).run('m-3', now, now + 1000);
    db.prepare(`INSERT INTO memberships (
        membership_id, agent_id, room_id, role, joined_at_ms
      ) VALUES (?, 'a-4', 'r-2', 'observer', ?)`).run('m-4', now + 2000);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM memberships
                               WHERE agent_id='a-4' AND room_id='r-2'`).get() as { c: number }).c;
    expect(count).toBe(2);
  });
});

describe('v0.2 invariant — memberships has NO fanout_target_runtime_id', () => {
  it('PRAGMA table_info(memberships) does NOT include fanout_target_runtime_id', () => {
    const db = getIdentityDb();
    const cols = db.prepare(`PRAGMA table_info(memberships)`).all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('fanout_target_runtime_id');
    expect(colNames).not.toContain('fanout_runtime_id');
    expect(colNames).not.toContain('cached_runtime_id');
  });

  it('memberships exposes only the documented v0.2 columns', () => {
    const db = getIdentityDb();
    const cols = db.prepare(`PRAGMA table_info(memberships)`).all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
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

describe('v0.2 — agents.primary_trust_key_id is nullable + targets identity_keys (Option D)', () => {
  it('an agent can be inserted with primary_trust_key_id = NULL', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (
        agent_id, display_name, primary_handle, primary_trust_key_id, status, created_at_ms
      ) VALUES (?, ?, ?, NULL, 'live', ?)`).run('a-5', 'Agent Five', '@five', now);
    const row = db.prepare(`SELECT primary_trust_key_id FROM agents WHERE agent_id='a-5'`)
      .get() as { primary_trust_key_id: string | null };
    expect(row.primary_trust_key_id).toBe(null);
  });

  it('an agent can be linked to a PR #99 identity_keys row via primary_trust_key_id', () => {
    const db = getIdentityDb();
    const now = Date.now();
    // Insert an identity + identity_key (PR #99 substrate) then point an
    // agent at it. This mirrors production flow after Option D collapse —
    // identity_keys is the canonical key primitive; agents.primary_trust_key_id
    // is the soft pointer.
    db.prepare(`INSERT INTO identities (
        identity_id, kind, display_name, canonical_handle, created_at_ms
      ) VALUES (?, 'agent', ?, ?, ?)`).run('idn-1', 'Agent Six', '@six', now);
    db.prepare(`INSERT INTO identity_keys (
        key_id, identity_id, device_label, public_key, key_kind, created_at_ms
      ) VALUES (?, 'idn-1', 'laptop', 'ed25519-pubkey-1', 'device', ?)`).run('k-1', now);
    db.prepare(`INSERT INTO agents (
        agent_id, display_name, primary_handle, primary_trust_key_id, status, created_at_ms
      ) VALUES (?, ?, ?, 'k-1', 'live', ?)`).run('a-6', 'Agent Six', '@six', now);
    const row = db.prepare(`SELECT primary_trust_key_id FROM agents WHERE agent_id='a-6'`)
      .get() as { primary_trust_key_id: string };
    expect(row.primary_trust_key_id).toBe('k-1');
  });

  it('FK rejects primary_trust_key_id pointing at a non-existent identity_keys row', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (
        agent_id, display_name, primary_handle, status, created_at_ms
      ) VALUES (?, ?, ?, 'live', ?)`).run('a-7', 'Agent Seven', '@seven', now);
    expect(() =>
      db.prepare(`UPDATE agents SET primary_trust_key_id='nonexistent' WHERE agent_id='a-7'`).run()
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('v0.2 — audit_events.entity_kind CHECK covers all owned + sibling entity types', () => {
  it('accepts every entity_kind listed in the spec + "system"', () => {
    const db = getIdentityDb();
    const now = Date.now();
    for (const kind of V02_ENTITY_KINDS) {
      db.prepare(`INSERT INTO audit_events (
          audit_id, at_ms, kind, entity_kind, entity_id
        ) VALUES (?, ?, ?, ?, ?)`)
        .run(`ev-${kind}`, now, `${kind}.created`, kind, `entity-${kind}`);
    }
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM audit_events`).get() as { c: number }).c;
    expect(count).toBe(V02_ENTITY_KINDS.length);
  });

  it('rejects an unknown entity_kind', () => {
    const db = getIdentityDb();
    const now = Date.now();
    expect(() =>
      db.prepare(`INSERT INTO audit_events (
          audit_id, at_ms, kind, entity_kind, entity_id
        ) VALUES (?, ?, ?, ?, ?)`).run('ev-bad', now, 'whatever', 'unknown_kind', 'e-x')
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('v0.2 — fanout target derives from agents.current_runtime_id', () => {
  it('current_runtime_id pointer can flip without touching memberships', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (
        agent_id, display_name, primary_handle, status, created_at_ms
      ) VALUES (?, ?, ?, 'live', ?)`).run('a-8', 'TigerResearch', '@tigerresearch', now);
    db.prepare(`INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-3', 'Tiger Room', 'private', now);
    db.prepare(`INSERT INTO memberships (
        membership_id, agent_id, room_id, role, joined_at_ms
      ) VALUES (?, 'a-8', 'r-3', 'member', ?)`).run('m-5', now);
    // Runtime A on laptop.
    db.prepare(`INSERT INTO runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-8', 'laptop', 100, '2026-05-29T20:00:00Z', 'live', ?, 'p-A')`)
      .run('rt-A', now);
    db.prepare(`UPDATE agents SET current_runtime_id='rt-A' WHERE agent_id='a-8'`).run();
    // Laptop dies → archive runtime A.
    db.prepare(`UPDATE runtimes SET status='archived', ended_at_ms=? WHERE runtime_id='rt-A'`)
      .run(now + 1000);
    db.prepare(`UPDATE agents SET current_runtime_id=NULL WHERE agent_id='a-8'`).run();
    // Mini comes up → runtime B becomes live + agents pointer flips.
    db.prepare(`INSERT INTO runtimes (
        runtime_id, agent_id, host, pid, pid_start_iso, status, started_at_ms, register_challenge_proof
      ) VALUES (?, 'a-8', 'macmini', 200, '2026-05-29T20:05:00Z', 'live', ?, 'p-B')`)
      .run('rt-B', now + 2000);
    db.prepare(`UPDATE agents SET current_runtime_id='rt-B' WHERE agent_id='a-8'`).run();
    const memb = db.prepare(`SELECT * FROM memberships WHERE membership_id='m-5'`)
      .get() as Record<string, unknown>;
    expect(memb.agent_id).toBe('a-8');
    expect(memb.room_id).toBe('r-3');
    expect('fanout_target_runtime_id' in memb).toBe(false);
    const fanoutTarget = db.prepare(
      `SELECT a.current_runtime_id AS rt
         FROM memberships m
         JOIN agents a ON a.agent_id = m.agent_id
         WHERE m.room_id = ? AND m.left_at_ms IS NULL`
    ).all('r-3') as { rt: string | null }[];
    expect(fanoutTarget).toEqual([{ rt: 'rt-B' }]);
  });
});

describe('v0.2 — user_room_preferences uniqueness', () => {
  it('UNIQUE INDEX(user_agent_id, room_id) rejects a second pref for the same pair', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('u-1', 'JWPK', '@jwpk', now);
    db.prepare(`INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-pref-1', 'Pref Room', 'private', now);
    db.prepare(`INSERT INTO user_room_preferences (
        preference_id, user_agent_id, room_id, starred, created_at_ms, updated_at_ms
      ) VALUES (?, 'u-1', 'r-pref-1', 1, ?, ?)`).run('pref-1', now, now);
    expect(() =>
      db.prepare(`INSERT INTO user_room_preferences (
          preference_id, user_agent_id, room_id, starred, created_at_ms, updated_at_ms
        ) VALUES (?, 'u-1', 'r-pref-1', 0, ?, ?)`).run('pref-2', now, now)
    ).toThrow(/UNIQUE constraint failed.*user_room_preferences/);
  });

  it('accepts nullable optional columns (sort_order, last_read_at_ms, notification_pref)', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('u-2', 'JWPK', '@jwpk', now);
    db.prepare(`INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-pref-2', 'Pref Room', 'private', now);
    db.prepare(`INSERT INTO user_room_preferences (
        preference_id, user_agent_id, room_id, created_at_ms, updated_at_ms
      ) VALUES (?, 'u-2', 'r-pref-2', ?, ?)`).run('pref-3', now, now);
    const row = db.prepare(`SELECT * FROM user_room_preferences WHERE preference_id='pref-3'`)
      .get() as Record<string, unknown>;
    expect(row.starred).toBe(0);
    expect(row.sort_order).toBe(null);
    expect(row.notification_pref).toBe(null);
  });

  it('rejects invalid notification_pref values', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('u-3', 'JWPK', '@jwpk', now);
    db.prepare(`INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-pref-3', 'Pref Room', 'private', now);
    expect(() =>
      db.prepare(`INSERT INTO user_room_preferences (
          preference_id, user_agent_id, room_id, notification_pref, created_at_ms, updated_at_ms
        ) VALUES (?, 'u-3', 'r-pref-3', 'invalid', ?, ?)`).run('pref-bad', now, now)
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('v0.2 — user_panel_pins uniqueness with soft-unpin', () => {
  it('UNIQUE INDEX permits re-pin after soft-unpin (unpinned_at_ms set)', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('u-4', 'JWPK', '@jwpk', now);
    db.prepare(`INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
                VALUES (?, ?, ?, ?)`).run('r-pin-1', 'Pin Room', 'private', now);
    db.prepare(`INSERT INTO user_panel_pins (
        pin_id, user_agent_id, entity_kind, entity_id, display_order, pinned_at_ms, unpinned_at_ms
      ) VALUES (?, 'u-4', 'room', 'r-pin-1', 1.0, ?, ?)`).run('pin-1', now, now + 1000);
    // Re-pin same entity — should succeed because the first row is
    // soft-unpinned and the partial UNIQUE index excludes it.
    db.prepare(`INSERT INTO user_panel_pins (
        pin_id, user_agent_id, entity_kind, entity_id, display_order, pinned_at_ms
      ) VALUES (?, 'u-4', 'room', 'r-pin-1', 2.0, ?)`).run('pin-2', now + 2000);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM user_panel_pins
                               WHERE user_agent_id='u-4' AND entity_id='r-pin-1'`)
      .get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it('UNIQUE INDEX rejects double-active pin for same (user, kind, id)', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('u-5', 'JWPK', '@jwpk', now);
    db.prepare(`INSERT INTO user_panel_pins (
        pin_id, user_agent_id, entity_kind, entity_id, display_order, pinned_at_ms
      ) VALUES (?, 'u-5', 'plan', 'plan-abc', 1.0, ?)`).run('pin-3', now);
    expect(() =>
      db.prepare(`INSERT INTO user_panel_pins (
          pin_id, user_agent_id, entity_kind, entity_id, display_order, pinned_at_ms
        ) VALUES (?, 'u-5', 'plan', 'plan-abc', 2.0, ?)`).run('pin-4', now + 1000)
    ).toThrow(/UNIQUE constraint failed.*user_panel_pins/);
  });

  it('rejects unknown entity_kind', () => {
    const db = getIdentityDb();
    const now = Date.now();
    db.prepare(`INSERT INTO agents (agent_id, display_name, primary_handle, status, created_at_ms)
                VALUES (?, ?, ?, 'live', ?)`).run('u-6', 'JWPK', '@jwpk', now);
    expect(() =>
      db.prepare(`INSERT INTO user_panel_pins (
          pin_id, user_agent_id, entity_kind, entity_id, display_order, pinned_at_ms
        ) VALUES (?, 'u-6', 'totally-invalid', 'x', 1.0, ?)`).run('pin-bad', now)
    ).toThrow(/CHECK constraint failed/);
  });
});
