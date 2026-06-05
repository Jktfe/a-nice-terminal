import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { resolveCanonicalMember, backfillRosterFromAllLegacy, verifyRosterConsolidation } from './membershipRosterBackfill';
import { isMember, listMembers } from './membershipStore';
import { createAgent } from './v02AgentsStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;
const prevOp = process.env.ANT_OPERATOR_HANDLE;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-roster-backfill-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  process.env.ANT_OPERATOR_HANDLE = '@JWPK'; // so @you canonicalises (tier-4 operator)
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  for (const [k, v] of [
    ['ANT_FRESH_DB_PATH', prevDb],
    ['ANT_MEMORY_VAULT_PATH', prevVault],
    ['ANT_OPERATOR_HANDLE', prevOp]
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Seeders for the three legacy sources.
function seedChatRoom(roomId: string): void {
  getIdentityDb()
    .prepare(
      `INSERT OR IGNORE INTO chat_rooms (id, name, last_update, when_it_was_created, who_created_it, creation_order)
       VALUES (?, ?, 't', 't', '@you', abs(random()) % 1000000)`
    )
    .run(roomId, roomId);
}
function seedChatRoomMember(roomId: string, handle: string): void {
  seedChatRoom(roomId);
  getIdentityDb()
    .prepare(
      `INSERT OR IGNORE INTO chat_room_members (room_id, handle, display_name, kind, joined_at)
       VALUES (?, ?, ?, 'agent', 't')`
    )
    .run(roomId, handle, handle);
}

describe('resolveCanonicalMember — tier precedence + fail-safe', () => {
  it('tier 1: resolves to the agentID primary_handle when an agent exists', () => {
    const agent = createAgent({ display_name: 'Tony', primary_handle: '@tony', primary_trust_key_id: null, owner_org: null });
    const r = resolveCanonicalMember('room1', '@tony');
    expect(r.tier).toBe(1);
    expect(r.identityKey).toBe(`agent:${agent.agent_id}`);
    expect(r.canonicalHandle).toBe('@tony');
  });

  it('tier 4: operator @you canonicalises to @JWPK (proven same)', () => {
    const you = resolveCanonicalMember('room1', '@you');
    const jwpk = resolveCanonicalMember('room1', '@JWPK');
    expect(you.canonicalHandle).toBe('@JWPK');
    expect(jwpk.canonicalHandle).toBe('@JWPK');
    // both collapse to the SAME identity key → they dedup
    expect(you.identityKey).toBe(jwpk.identityKey);
  });

  it('tier 5: an unknown handle falls back, room-scoped + DISTINCT', () => {
    const r = resolveCanonicalMember('room1', '@randoagent');
    expect(r.tier).toBe(5);
    expect(r.canonicalHandle).toBe('@randoagent');
    expect(r.identityKey).toBe('handle:room1:@randoagent');
  });

  it('FAIL-SAFE: @speedy and @speedy-2 stay DISTINCT (never string-merged)', () => {
    const a = resolveCanonicalMember('room1', '@speedy');
    const b = resolveCanonicalMember('room1', '@speedy-2');
    // no agent/session/lease proves them same → distinct tier-5 keys, not merged
    expect(a.identityKey).not.toBe(b.identityKey);
    expect(a.canonicalHandle).not.toBe(b.canonicalHandle);
  });
});

describe('backfillRosterFromAllLegacy — union, lossless + injective', () => {
  it('unions all three sources; operator dupes collapse, distinct stay distinct', () => {
    const agent = createAgent({ display_name: 'Tony', primary_handle: '@tony', primary_trust_key_id: null, owner_org: null });

    // @tony only in chat_room_members; @vera only in room_memberships; @you in BOTH
    // (as @you in chat_room_members) — must dedup with @JWPK form.
    seedChatRoomMember('roomA', '@tony');
    seedChatRoomMember('roomA', '@you');
    // legacy room_memberships rows reference a terminal we don't seed — FK off for the fixture
    getIdentityDb().pragma('foreign_keys = OFF');
    getIdentityDb()
      .prepare(`INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at) VALUES (?, 'roomA', '@vera', 't-vera', 0)`)
      .run('rm1');
    // @JWPK in room_memberships too — SAME identity as the chat_room_members @you
    getIdentityDb()
      .prepare(`INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at) VALUES (?, 'roomA', '@JWPK', 't-jwpk', 0)`)
      .run('rm2');

    const report = backfillRosterFromAllLegacy();

    // NO DROPS: every legacy member present (under its canonical handle)
    expect(isMember('roomA', '@tony')).toBe(true);
    expect(isMember('roomA', '@vera')).toBe(true);
    expect(isMember('roomA', '@JWPK')).toBe(true); // @you collapsed here

    // NO DUPES: @you and @JWPK are ONE row, not two
    const members = listMembers('roomA').map((m) => m.handle).sort();
    expect(members).toEqual(['@JWPK', '@tony', '@vera']);

    // injective check: no (room, handle) appears twice
    const byHandle = new Set(members);
    expect(byHandle.size).toBe(members.length);

    // audit: @tony resolved tier-1 (agent), @you tier-4 (operator); report sane
    expect(report.tierCounts[1]).toBeGreaterThanOrEqual(1); // @tony
    expect(report.tierCounts[4]).toBeGreaterThanOrEqual(1); // @you→@JWPK
    expect(report.sources.chat_room_members).toBe(2);
    expect(report.sources.room_memberships).toBe(2);
    // tony's agent id is referenced (sanity the resolver wired)
    expect(agent.agent_id).toBeTruthy();
  });

  it('is idempotent (second run writes no new distinct rows)', () => {
    seedChatRoomMember('roomB', '@solo');
    const first = backfillRosterFromAllLegacy();
    const second = backfillRosterFromAllLegacy();
    expect(listMembers('roomB')).toHaveLength(1);
    expect(first.written).toBe(second.written);
  });

  it('tier-5 fallback rows are LISTED explicitly, not hidden', () => {
    seedChatRoomMember('roomC', '@unknownthing');
    const report = backfillRosterFromAllLegacy();
    expect(report.fallbackRows).toContainEqual({ room_id: 'roomC', handle: '@unknownthing' });
  });
});

describe('verifyRosterConsolidation — proof on PERSISTED identity', () => {
  it('GREEN after backfill: noDrops=0, noDupes=0, tiers audited', () => {
    createAgent({ display_name: 'Vera', primary_handle: '@vera', primary_trust_key_id: null, owner_org: null });
    seedChatRoomMember('roomV', '@vera'); // tier 1 agent
    seedChatRoomMember('roomV', '@you'); // tier 4 → @JWPK
    seedChatRoomMember('roomV', '@randoX'); // tier 5 fallback
    backfillRosterFromAllLegacy();
    const r = verifyRosterConsolidation();
    expect(r.noDrops.count).toBe(0);
    expect(r.noDupes.count).toBe(0);
    expect(r.tierCounts[1]).toBeGreaterThanOrEqual(1);
    expect(r.tierCounts[4]).toBeGreaterThanOrEqual(1);
    expect(r.fallbackRows).toContainEqual({ room_id: 'roomV', handle: '@randoX' });
  });

  it('FALSIFIABLE: a member missing from the persisted roster FAILS the proof (catches drops)', () => {
    seedChatRoomMember('roomD', '@present');
    seedChatRoomMember('roomD', '@dropped');
    backfillRosterFromAllLegacy();
    // simulate a backfill that mis-wrote / dropped a member
    getIdentityDb().prepare(`DELETE FROM room_membership WHERE room_id='roomD' AND handle='@dropped'`).run();
    const r = verifyRosterConsolidation();
    expect(r.noDrops.count).toBeGreaterThan(0);
    expect(r.noDrops.details.some((d) => d.handle === '@dropped')).toBe(true);
  });

  it('idempotent: backfill run twice = identical room_membership row count (re-runnable on boot)', () => {
    seedChatRoomMember('roomI', '@a');
    seedChatRoomMember('roomI', '@b');
    backfillRosterFromAllLegacy();
    const c1 = (getIdentityDb().prepare(`SELECT COUNT(*) AS c FROM room_membership`).get() as { c: number }).c;
    backfillRosterFromAllLegacy();
    const c2 = (getIdentityDb().prepare(`SELECT COUNT(*) AS c FROM room_membership`).get() as { c: number }).c;
    expect(c2).toBe(c1);
  });
});
