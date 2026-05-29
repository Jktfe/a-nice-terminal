/**
 * v02AgentsStore tests — durable identity primitive for v0.2.
 *
 * Mirrors the test scaffolding in v02-schema.test.ts: per-test tmpDir +
 * per-test DB reset to isolate constraint behaviour.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import * as v02Agents from './v02AgentsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-agents-'));
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

describe('v02AgentsStore.createAgent', () => {
  it('inserts a row with normalised handle (leading @ added)', () => {
    const row = v02Agents.createAgent({
      display_name: 'TigerResearch',
      primary_handle: 'tigerresearch'
    });
    expect(row.primary_handle).toBe('@tigerresearch');
    expect(row.status).toBe('live');
    expect(row.current_runtime_id).toBe(null);
    expect(row.reclaim_count).toBe(0);
  });

  it('preserves a handle that already has a leading @', () => {
    const row = v02Agents.createAgent({
      display_name: 'X',
      primary_handle: '@cv4'
    });
    expect(row.primary_handle).toBe('@cv4');
  });

  it('accepts an explicit primary_trust_key_id pointing at identity_keys', () => {
    // Bootstrap an identity_keys row from PR #99 to satisfy the FK.
    const db = getIdentityDb();
    const now_ms = Date.now();
    db.prepare(
      `INSERT INTO identities (identity_id, kind, display_name, canonical_handle, created_at_ms)
       VALUES (?, 'agent', ?, ?, ?)`
    ).run('id-1', 'X', '@x', now_ms);
    db.prepare(
      `INSERT INTO identity_keys (key_id, identity_id, device_label, public_key, key_kind, created_at_ms)
       VALUES (?, 'id-1', 'laptop', ?, 'device', ?)`
    ).run('k-1', 'pubkey-bytes', now_ms);
    const row = v02Agents.createAgent({
      display_name: 'X',
      primary_handle: '@x',
      primary_trust_key_id: 'k-1'
    });
    expect(row.primary_trust_key_id).toBe('k-1');
  });
});

describe('v02AgentsStore.getAgentByHandle / getLiveAgentByHandle', () => {
  it('returns null when no agent matches', () => {
    expect(v02Agents.getAgentByHandle('@nobody')).toBe(null);
  });

  it('resolves to the most-recently-created agent on handle collision', () => {
    const first = v02Agents.createAgent({ display_name: 'first', primary_handle: '@dup' });
    // Bump created_at_ms forward so the ORDER BY tie is broken
    // deterministically (two createAgent calls back-to-back can race the
    // millisecond clock on fast machines — production code wouldn't
    // notice; this test pins the relative ordering).
    const db = getIdentityDb();
    db.prepare(`UPDATE v02_agents SET created_at_ms = ? WHERE agent_id = ?`).run(
      Date.now() + 1000,
      first.agent_id
    );
    const second = v02Agents.createAgent({ display_name: 'second', primary_handle: '@dup' });
    db.prepare(`UPDATE v02_agents SET created_at_ms = ? WHERE agent_id = ?`).run(
      Date.now() + 2000,
      second.agent_id
    );
    const row = v02Agents.getAgentByHandle('@dup');
    expect(row?.agent_id).toBe(second.agent_id);
  });

  it('getLiveAgentByHandle excludes archived rows', () => {
    const first = v02Agents.createAgent({ display_name: 'first', primary_handle: '@retiree' });
    v02Agents.setAgentStatus(first.agent_id, 'archived');
    expect(v02Agents.getLiveAgentByHandle('@retiree')).toBe(null);
  });
});

describe('v02AgentsStore.setAgentStatus + lists', () => {
  it('listLiveAgents excludes archived + deleted rows', () => {
    const live = v02Agents.createAgent({ display_name: 'L', primary_handle: '@l' });
    const archived = v02Agents.createAgent({ display_name: 'A', primary_handle: '@a' });
    const deleted = v02Agents.createAgent({ display_name: 'D', primary_handle: '@d' });
    v02Agents.setAgentStatus(archived.agent_id, 'archived');
    v02Agents.setAgentStatus(deleted.agent_id, 'deleted');
    const live_ids = v02Agents.listLiveAgents().map((r) => r.agent_id);
    expect(live_ids).toContain(live.agent_id);
    expect(live_ids).not.toContain(archived.agent_id);
    expect(live_ids).not.toContain(deleted.agent_id);
  });

  it('listAgents includes all rows regardless of status', () => {
    v02Agents.createAgent({ display_name: 'L', primary_handle: '@l' });
    const a = v02Agents.createAgent({ display_name: 'A', primary_handle: '@a' });
    v02Agents.setAgentStatus(a.agent_id, 'archived');
    expect(v02Agents.listAgents().length).toBe(2);
  });

  it('setAgentStatus is idempotent (no-op on missing agent returns false)', () => {
    expect(v02Agents.setAgentStatus('nonexistent', 'archived')).toBe(false);
  });
});

describe('v02AgentsStore.setCurrentRuntimeId + incrementReclaimCount', () => {
  it('updates the runtime pointer (fanout structural invariant)', () => {
    const row = v02Agents.createAgent({ display_name: 'X', primary_handle: '@x' });
    // No FK enforcement here on a bare write — we test the pointer write
    // semantics; integration with v02_runtimes is tested in
    // v02RuntimesStore.test.ts where we go through registerRuntime() which
    // satisfies the FK.
    expect(row.current_runtime_id).toBe(null);
    // Insert a runtime first so the FK is happy.
    const db = getIdentityDb();
    db.prepare(
      `INSERT INTO v02_runtimes
         (runtime_id, agent_id, host, pid, pid_start_iso, status,
          started_at_ms, register_challenge_proof)
       VALUES ('rt-x', ?, 'host-1', 1, '2026-05-29T00:00:00Z', 'live', ?, 'proof')`
    ).run(row.agent_id, Date.now());
    v02Agents.setCurrentRuntimeId(row.agent_id, 'rt-x');
    const after = v02Agents.getAgentById(row.agent_id);
    expect(after?.current_runtime_id).toBe('rt-x');
  });

  it('incrementReclaimCount bumps the counter monotonically', () => {
    const row = v02Agents.createAgent({ display_name: 'X', primary_handle: '@x' });
    expect(v02Agents.incrementReclaimCount(row.agent_id)).toBe(1);
    expect(v02Agents.incrementReclaimCount(row.agent_id)).toBe(2);
    expect(v02Agents.incrementReclaimCount(row.agent_id)).toBe(3);
  });

  it('incrementReclaimCount on missing agent returns 0', () => {
    expect(v02Agents.incrementReclaimCount('nonexistent')).toBe(0);
  });
});
