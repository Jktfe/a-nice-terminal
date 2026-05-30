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

describe('v02MembershipsStore — M9d display columns', () => {
  it('addMembership persists display_color / display_icon / display_background_style / member_kind', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const m = v02Memberships.addMembership({
      agent_id: agent.agent_id,
      room_id: room,
      display_color: '#FF00AA',
      display_icon: 'X',
      display_background_style: 'tint',
      member_kind: 'agent'
    });
    expect(m.display_color).toBe('#FF00AA');
    expect(m.display_icon).toBe('X');
    expect(m.display_background_style).toBe('tint');
    expect(m.member_kind).toBe('agent');
  });

  it('addMembership leaves display fields NULL when omitted (legacy fallback)', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const m = v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    expect(m.display_color).toBe(null);
    expect(m.display_icon).toBe(null);
    expect(m.display_background_style).toBe(null);
    expect(m.member_kind).toBe(null);
  });

  it('addMembership re-add updates display fields when supplied; leaves untouched when undefined', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    v02Memberships.addMembership({
      agent_id: agent.agent_id,
      room_id: room,
      display_color: '#111111'
    });
    // Re-add with no display fields — existing colour preserved.
    const second = v02Memberships.addMembership({
      agent_id: agent.agent_id,
      room_id: room,
      role: 'chair'
    });
    expect(second.display_color).toBe('#111111');
    expect(second.role).toBe('chair');
    // Re-add with new colour — colour updates.
    const third = v02Memberships.addMembership({
      agent_id: agent.agent_id,
      room_id: room,
      display_color: '#222222'
    });
    expect(third.display_color).toBe('#222222');
  });

  it('updateMembershipPresentation patches active row in place', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
    const flipped = v02Memberships.updateMembershipPresentation({
      agent_id: agent.agent_id,
      room_id: room,
      display_color: '#333',
      display_icon: 'J',
      display_background_style: 'card'
    });
    expect(flipped).toBe(true);
    const row = v02Memberships.getActiveMembership(room, agent.agent_id);
    expect(row?.display_color).toBe('#333');
    expect(row?.display_icon).toBe('J');
    expect(row?.display_background_style).toBe('card');
  });

  it('updateMembershipPresentation returns false when no active membership exists', () => {
    const room = createRoom('r-1');
    const result = v02Memberships.updateMembershipPresentation({
      agent_id: 'no-such-agent',
      room_id: room,
      display_color: '#000'
    });
    expect(result).toBe(false);
  });

  it('member_kind CHECK constraint rejects garbage values', () => {
    const room = createRoom('r-1');
    const agent = createAgent('@x');
    const db = getIdentityDb();
    expect(() =>
      db.prepare(
        `INSERT INTO memberships
           (membership_id, agent_id, room_id, role, joined_at_ms, member_kind)
         VALUES (?, ?, ?, 'member', ?, 'robot')`
      ).run('m-bogus', agent.agent_id, room, Date.now())
    ).toThrow();
  });
});

describe('v02MembershipsStore.listRoomMembersHydrated', () => {
  it('returns members with handle + display_name + presentation columns from JOIN agents', () => {
    const room = createRoom('r-1');
    const a = createAgent('@codex4');
    const b = createAgent('@cv4');
    v02Memberships.addMembership({
      agent_id: a.agent_id,
      room_id: room,
      display_color: '#AAA',
      display_icon: 'C',
      display_background_style: 'transparent',
      member_kind: 'agent'
    });
    v02Memberships.addMembership({
      agent_id: b.agent_id,
      room_id: room,
      member_kind: 'agent'
    });
    const members = v02Memberships.listRoomMembersHydrated(room);
    expect(members.length).toBe(2);
    const handles = members.map((m) => m.handle).sort();
    expect(handles).toEqual(['@codex4', '@cv4']);
    const codex = members.find((m) => m.handle === '@codex4');
    expect(codex?.agent_display_name).toBe('@codex4');
    expect(codex?.display_color).toBe('#AAA');
    expect(codex?.display_icon).toBe('C');
    expect(codex?.display_background_style).toBe('transparent');
    expect(codex?.member_kind).toBe('agent');
    expect(typeof codex?.joined_at_iso).toBe('string');
    expect(codex?.joined_at_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('per-room alias takes precedence over primary_handle in the handle column', () => {
    const room = createRoom('r-1');
    const a = createAgent('@cv4');
    v02Memberships.addMembership({
      agent_id: a.agent_id,
      room_id: room,
      room_alias: '@chair'
    });
    const members = v02Memberships.listRoomMembersHydrated(room);
    expect(members[0].handle).toBe('@chair');
    expect(members[0].room_alias).toBe('@chair');
  });

  it('excludes historical (left_at_ms NOT NULL) rows', () => {
    const room = createRoom('r-1');
    const a = createAgent('@a');
    const b = createAgent('@b');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    v02Memberships.addMembership({ agent_id: b.agent_id, room_id: room });
    v02Memberships.removeMembership(b.agent_id, room);
    const members = v02Memberships.listRoomMembersHydrated(room);
    expect(members.length).toBe(1);
    expect(members[0].handle).toBe('@a');
  });

  it('returns empty array for an unknown room', () => {
    expect(v02Memberships.listRoomMembersHydrated('no-such-room')).toEqual([]);
  });
});

describe('v02MembershipsStore.isHandleActiveMemberOfRoom', () => {
  it('returns true for an active member by primary_handle', () => {
    const room = createRoom('r-1');
    const a = createAgent('@x');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    expect(v02Memberships.isHandleActiveMemberOfRoom(room, '@x')).toBe(true);
  });

  it('returns true for an active member by room_alias', () => {
    const room = createRoom('r-1');
    const a = createAgent('@cv4');
    v02Memberships.addMembership({
      agent_id: a.agent_id,
      room_id: room,
      room_alias: '@chair'
    });
    expect(v02Memberships.isHandleActiveMemberOfRoom(room, '@chair')).toBe(true);
  });

  it('returns false for an unknown handle', () => {
    const room = createRoom('r-1');
    expect(v02Memberships.isHandleActiveMemberOfRoom(room, '@ghost')).toBe(false);
  });

  it('returns false after the member is soft-removed', () => {
    const room = createRoom('r-1');
    const a = createAgent('@x');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    v02Memberships.removeMembership(a.agent_id, room);
    expect(v02Memberships.isHandleActiveMemberOfRoom(room, '@x')).toBe(false);
  });

  it('normalises a missing leading @', () => {
    const room = createRoom('r-1');
    const a = createAgent('@x');
    v02Memberships.addMembership({ agent_id: a.agent_id, room_id: room });
    expect(v02Memberships.isHandleActiveMemberOfRoom(room, 'x')).toBe(true);
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
