/**
 * v02RuntimesStore tests — ephemeral runtime primitive + the
 * UNIQUE-WHERE-LIVE structural invariant.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { seedSiblingFkTargets } from './v02TestFixtures';
import * as v02Agents from './v02AgentsStore';
import * as v02Runtimes from './v02RuntimesStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-runtimes-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
  // Option D collapse — seed PR #99/#105/#106 FK target tables.
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

function createAgent(handle: string) {
  return v02Agents.createAgent({ display_name: handle, primary_handle: handle });
}

describe('v02RuntimesStore.registerRuntime', () => {
  it('inserts a row + flips agents.current_runtime_id to the new id', () => {
    const agent = createAgent('@x');
    const runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'macmini',
      pid: 1234,
      pid_start_iso: '2026-05-30T01:00:00Z',
      register_challenge_proof: 'proof-1'
    });
    expect(runtime.status).toBe('live');
    expect(runtime.host).toBe('macmini');
    expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(runtime.runtime_id);
  });

  it('rejects dual-live-bind with SQLITE_CONSTRAINT_UNIQUE', () => {
    const agent = createAgent('@x');
    v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'laptop',
      pid: 1,
      pid_start_iso: '2026-05-30T01:00:00Z',
      register_challenge_proof: 'p1'
    });
    expect(() =>
      v02Runtimes.registerRuntime({
        agent_id: agent.agent_id,
        host: 'macmini',
        pid: 2,
        pid_start_iso: '2026-05-30T01:01:00Z',
        register_challenge_proof: 'p2'
      })
    ).toThrow(/UNIQUE/);
  });
});

describe('v02RuntimesStore.lookupRuntimeByPidChain', () => {
  it('walks the chain parent-first + returns the live row that matches', () => {
    const agent = createAgent('@x');
    const runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'host',
      pid: 100,
      pid_start_iso: '2026-05-30T02:00:00Z',
      register_challenge_proof: 'p1'
    });
    const found = v02Runtimes.lookupRuntimeByPidChain([
      { pid: 999, pid_start_iso: '2026-05-30T02:00:00Z' }, // miss
      { pid: 100, pid_start_iso: '2026-05-30T02:00:00Z' } // hit
    ]);
    expect(found?.runtime_id).toBe(runtime.runtime_id);
  });

  it('returns null when no chain entry matches a live row', () => {
    const found = v02Runtimes.lookupRuntimeByPidChain([
      { pid: 1, pid_start_iso: '2026-05-30T03:00:00Z' }
    ]);
    expect(found).toBe(null);
  });

  it('does NOT match a runtime whose status is not live', () => {
    const agent = createAgent('@x');
    const runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'host',
      pid: 200,
      pid_start_iso: '2026-05-30T04:00:00Z',
      register_challenge_proof: 'p1'
    });
    v02Runtimes.setRuntimeStatus(runtime.runtime_id, 'archived');
    const found = v02Runtimes.lookupRuntimeByPidChain([
      { pid: 200, pid_start_iso: '2026-05-30T04:00:00Z' }
    ]);
    expect(found).toBe(null);
  });
});

describe('v02RuntimesStore.setRuntimeStatus', () => {
  it('clears agents.current_runtime_id when flipping live → archived', () => {
    const agent = createAgent('@x');
    const runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'host',
      pid: 1,
      pid_start_iso: '2026-05-30T05:00:00Z',
      register_challenge_proof: 'p'
    });
    expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(runtime.runtime_id);
    v02Runtimes.setRuntimeStatus(runtime.runtime_id, 'archived');
    expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(null);
  });

  it('does NOT clear pointer if it points at a different runtime', () => {
    // Edge case: agent has been re-pointed at a NEW runtime after this
    // one was registered; archiving the OLD one shouldn't yank the
    // pointer away from the new one.
    const agent = createAgent('@x');
    const runtime_a = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'a',
      pid: 1,
      pid_start_iso: '2026-05-30T06:00:00Z',
      register_challenge_proof: 'pa'
    });
    // Archive A first so the live UNIQUE constraint lets us register B.
    v02Runtimes.setRuntimeStatus(runtime_a.runtime_id, 'archived');
    const runtime_b = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'b',
      pid: 2,
      pid_start_iso: '2026-05-30T06:01:00Z',
      register_challenge_proof: 'pb'
    });
    expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(runtime_b.runtime_id);
    // Set A to reclaimed (legal terminal status) — must NOT clear pointer at B.
    v02Runtimes.setRuntimeStatus(runtime_a.runtime_id, 'reclaimed');
    expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(runtime_b.runtime_id);
  });
});

describe('v02RuntimesStore.reclaimRuntime', () => {
  it('atomically flips old → reclaimed + registers new + bumps reclaim_count', () => {
    const agent = createAgent('@tigerresearch');
    const old = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'laptop',
      pid: 100,
      pid_start_iso: '2026-05-30T07:00:00Z',
      register_challenge_proof: 'p-old'
    });
    const newRuntime = v02Runtimes.reclaimRuntime({
      old_runtime_id: old.runtime_id,
      new_runtime_input: {
        agent_id: agent.agent_id,
        host: 'macmini',
        pid: 200,
        pid_start_iso: '2026-05-30T07:05:00Z',
        register_challenge_proof: 'p-new'
      }
    });
    expect(newRuntime.status).toBe('live');
    expect(newRuntime.host).toBe('macmini');
    const oldAfter = v02Runtimes.getRuntimeById(old.runtime_id);
    expect(oldAfter?.status).toBe('reclaimed');
    expect(oldAfter?.reclaimed_by_runtime_id).toBe(newRuntime.runtime_id);
    expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(newRuntime.runtime_id);
    expect(v02Agents.getAgentById(agent.agent_id)?.reclaim_count).toBe(1);
  });

  it('throws on agent_id mismatch between old + new', () => {
    const a = createAgent('@a');
    const b = createAgent('@b');
    const old = v02Runtimes.registerRuntime({
      agent_id: a.agent_id,
      host: 'host',
      pid: 1,
      pid_start_iso: '2026-05-30T08:00:00Z',
      register_challenge_proof: 'p1'
    });
    expect(() =>
      v02Runtimes.reclaimRuntime({
        old_runtime_id: old.runtime_id,
        new_runtime_input: {
          agent_id: b.agent_id, // different agent
          host: 'host',
          pid: 2,
          pid_start_iso: '2026-05-30T08:01:00Z',
          register_challenge_proof: 'p2'
        }
      })
    ).toThrow(/agent_id mismatch/);
  });
});

describe('v02RuntimesStore.sweepStaleRuntimes', () => {
  it('flips live runtimes with stale heartbeats to stale', () => {
    const agent = createAgent('@x');
    const runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'host',
      pid: 1,
      pid_start_iso: '2026-05-30T09:00:00Z',
      register_challenge_proof: 'p'
    });
    // Backdate heartbeat to 10 minutes ago.
    v02Runtimes.touchHeartbeat(runtime.runtime_id, Date.now() - 10 * 60 * 1000);
    const flipped = v02Runtimes.sweepStaleRuntimes(5 * 60 * 1000);
    expect(flipped).toBe(1);
    expect(v02Runtimes.getRuntimeById(runtime.runtime_id)?.status).toBe('stale');
  });

  it('does NOT touch runtimes with fresh heartbeats', () => {
    const agent = createAgent('@x');
    const runtime = v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'host',
      pid: 1,
      pid_start_iso: '2026-05-30T09:05:00Z',
      register_challenge_proof: 'p'
    });
    v02Runtimes.touchHeartbeat(runtime.runtime_id);
    const flipped = v02Runtimes.sweepStaleRuntimes(5 * 60 * 1000);
    expect(flipped).toBe(0);
    expect(v02Runtimes.getRuntimeById(runtime.runtime_id)?.status).toBe('live');
  });
});
