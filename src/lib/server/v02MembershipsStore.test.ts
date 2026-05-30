/**
 * v02MembershipsStore tests — single-table membership + the
 * UNIQUE-WHERE-LIVE structural invariant + the DERIVED fanout query.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { seedSiblingFkTargets } from './v02TestFixtures';
import * as v02Agents from './v02AgentsStore';
import * as v02Runtimes from './v02RuntimesStore';
import * as v02Memberships from './v02MembershipsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-memberships-'));
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

function createRoom(room_id: string, display_name: string = room_id) {
  const db = getIdentityDb();
  const now_ms = Date.now();
  db.prepare(
    `INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
     VALUES (?, ?, 'private', ?)`
  ).run(room_id, display_name, now_ms);
  return room_id;
}

function createAgent(handle: string) {
  return v02Agents.createAgent({ display_name: handle, primary_handle: handle });
}

describe('v02MembershipsStore.addMembership', () => {
  it('inserts an active row with default role=member', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const m = v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    expect(m.role).toBe('member');
    expect(m.left_at_ms).toBe(null);
  });

  it('is idempotent on re-add (returns existing row)', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const first = v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    const second = v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    expect(second.membership_id).toBe(first.membership_id);
  });

  it('updates role + alias in-place when re-adding with different shape', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    const updated = v02Memberships.addMembership({
      agent_id: agent.agent_id,
      room_id: room,
      role: 'chair',
      room_alias: '@chairperson'
    });
    expect(updated.role).toBe('chair');
    expect(updated.room_alias).toBe('@chairperson');
  });

  it('normalises alias (leading @ added when missing)', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const m = v02Memberships.addMembership({
      agent_id: agent.agent_id,
      room_id: room,
      room_alias: 'tigerresearch'
    });
    expect(m.room_alias).toBe('@tigerresearch');
  });
});

describe('v02MembershipsStore — UNIQUE-WHERE-LIVE structural invariant', () => {
  it('rejects raw insertion of two active memberships for same (agent, room)', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    // Try to bypass the store + write a second active row directly.
    const db = getIdentityDb();
    expect(() =>
      db.prepare(
        `INSERT INTO memberships
           (membership_id, agent_id, room_id, role, joined_at_ms)
         VALUES (?, ?, ?, 'member', ?)`
      ).run('m-dup', agent.agent_id, room, Date.now())
    ).toThrow(/UNIQUE/);
  });

  it('allows a new active row AFTER the prior one is soft-removed', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const first = v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    v02Memberships.removeMembership(agent.agent_id, room);
    const second = v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    expect(second.membership_id).not.toBe(first.membership_id);
    expect(second.left_at_ms).toBe(null);
    // First row remains historical.
    const historical = v02Memberships.getMembershipById(first.membership_id);
    expect(historical?.left_at_ms).not.toBe(null);
  });
});

describe('v02MembershipsStore.removeMembership', () => {
  it('flips left_at_ms (soft-delete); no-op on missing row returns false', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    expect(v02Memberships.removeMembership(agent.agent_id, room)).toBe(true);
    expect(v02Memberships.removeMembership(agent.agent_id, room)).toBe(false);
  });
});

describe('v02MembershipsStore.list*', () => {
  it('listActiveMembershipsForRoom excludes historical', () => {
    const room = createRoom('r-1');
    const a = createAgent('@a');
    const b = createAgent('@b');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    v02Memberships.addMembership({ agent_id: b.agent_id, room_id: room });
    v02Memberships.removeMembership(b.agent_id, room);
    const active = v02Memberships.listActiveMembershipsForRoom(room);
    expect(active.length).toBe(1);
    expect(active[0].agent_id).toBe(a.agent_id);
  });

  it('listAllMembershipsForRoomIncludingHistorical returns everything', () => {
    const room = createRoom('r-1');
    const a = createAgent('@a');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    v02Memberships.removeMembership(a.agent_id, room);
    expect(v02Memberships.listAllMembershipsForRoomIncludingHistorical(room).length).toBe(1);
  });
});

describe('v02MembershipsStore.listFanoutTargetsForRoom (DERIVED, not cached)', () => {
  it('returns current_runtime_id per active member, derived live from agents', () => {
    const room = createRoom('r-1');
    const a = createAgent('@a');
    const b = createAgent('@b');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    v02Memberships.addMembership({ agent_id: b.agent_id, room_id: room });
    const rt_a = v02Runtimes.registerRuntime({
      agent_id: a.agent_id,
      host: 'h1',
      pid: 1,
      pid_start_iso: '2026-05-30T10:00:00Z',
      register_challenge_proof: 'pa'
    });
    // Agent B has no live runtime — appears with target=null.
    const targets = v02Memberships.listFanoutTargetsForRoom(room);
    const byAgent = new Map(targets.map((t) => [t.agent_id, t.runtime_id]));
    expect(byAgent.get(a.agent_id)).toBe(rt_a.runtime_id);
    expect(byAgent.get(b.agent_id)).toBe(null);
  });

  it('reflects pointer flip without any membership write (the structural fix)', () => {
    const room = createRoom('r-1');
    const a = createAgent('@a');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    const rt1 = v02Runtimes.registerRuntime({
      agent_id: a.agent_id,
      host: 'laptop',
      pid: 1,
      pid_start_iso: '2026-05-30T11:00:00Z',
      register_challenge_proof: 'p1'
    });
    expect(v02Memberships.listFanoutTargetsForRoom(room)[0].runtime_id).toBe(rt1.runtime_id);
    // Reclaim → pointer flips → fanout MUST follow without touching the
    // memberships row. THE bug fix.
    const rt2 = v02Runtimes.reclaimRuntime({
      old_runtime_id: rt1.runtime_id,
      new_runtime_input: {
        agent_id: a.agent_id,
        host: 'macmini',
        pid: 2,
        pid_start_iso: '2026-05-30T11:01:00Z',
        register_challenge_proof: 'p2'
      }
    });
    expect(v02Memberships.listFanoutTargetsForRoom(room)[0].runtime_id).toBe(rt2.runtime_id);
  });
});

describe('v02MembershipsStore.getActiveMembershipByHandle', () => {
  it('resolves via primary_handle when no alias is set', () => {
    const room = createRoom('r-1');
    const a = createAgent('@cv4');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    const found = v02Memberships.getActiveMembershipByHandle(room, '@cv4');
    expect(found?.agent_id).toBe(a.agent_id);
  });

  it('per-room alias takes precedence over primary_handle', () => {
    const room = createRoom('r-1');
    const a = createAgent('@cv4');
    v02Memberships.addMembership({
      agent_id: a.agent_id,
      room_id: room,
      room_alias: '@chair'
    });
    // Alias hits.
    expect(v02Memberships.getActiveMembershipByHandle(room, '@chair')?.agent_id).toBe(
      a.agent_id
    );
    // Primary handle still works as fallback.
    expect(v02Memberships.getActiveMembershipByHandle(room, '@cv4')?.agent_id).toBe(
      a.agent_id
    );
  });

  it('returns null when no agent matches', () => {
    const room = createRoom('r-1');
    expect(v02Memberships.getActiveMembershipByHandle(room, '@nobody')).toBe(null);
  });
});
