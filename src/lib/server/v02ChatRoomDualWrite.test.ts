/**
 * Integration tests for the M9c chat-room dual-write paths.
 *
 * Asserts that legacy chatRoomStore + humanInbox writes mirror their
 * membership rows into v02_memberships via the v02ChatRoomBridge shim.
 *
 * These tests exercise the *store-level* mirror calls directly rather
 * than going through the HTTP endpoints (the endpoint server.test.ts
 * files already exercise the legacy path; we only need to assert the
 * v0.2 sidecar fires correctly).
 *
 * After M9d ships these tests collapse into the v02-only equivalents.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { seedSiblingFkTargets } from './v02TestFixtures';
import {
  createChatRoom,
  inviteAgentToRoom,
  inviteHumanToRoom,
  removeMemberFromRoom
} from './chatRoomStore';
import { ensureHumanInboxRoom } from './humanInboxRoomStore';
import { recomputeInboxEdge } from './humanInboxMembership';
import * as v02Memberships from './v02MembershipsStore';
import * as v02Agents from './v02AgentsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-dualwrite-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test-dualwrite';
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

describe('chatRoomStore.createChatRoom dual-writes to v02_memberships', () => {
  it('writes a v02_memberships row for the human creator', () => {
    const room = createChatRoom({ name: 'm9c-test-1', whoCreatedIt: '@you' });
    const memberships = v02Memberships.listActiveMembershipsForRoom(room.id);
    expect(memberships.length).toBe(1);
    // The agent was auto-bootstrapped — verify it resolves back to @you.
    const agent = v02Agents.getAgentById(memberships[0].agent_id);
    expect(agent?.primary_handle).toBe('@you');
    expect(memberships[0].role).toBe('owner');
  });

  it('also writes an operator membership when the creator is a non-operator handle', () => {
    const room = createChatRoom({ name: 'm9c-test-2', whoCreatedIt: '@cv4' });
    const memberships = v02Memberships.listActiveMembershipsForRoom(room.id);
    expect(memberships.length).toBe(2);
    const handles = memberships
      .map((m) => v02Agents.getAgentById(m.agent_id)?.primary_handle)
      .sort();
    expect(handles).toEqual(['@JWPK', '@cv4']);
  });

  it('also writes a v02_rooms row keyed by the legacy chat_rooms.id', () => {
    const room = createChatRoom({ name: 'm9c-test-3', whoCreatedIt: '@you' });
    const v02Room = getIdentityDb()
      .prepare(`SELECT room_id, display_name FROM rooms WHERE room_id = ?`)
      .get(room.id) as { room_id: string; display_name: string } | undefined;
    expect(v02Room).toBeDefined();
    expect(v02Room?.display_name).toBe('m9c-test-3');
  });
});

describe('inviteAgentToRoom dual-writes to v02_memberships', () => {
  it('writes a v02_memberships row when inviting a new agent', () => {
    const room = createChatRoom({ name: 'invite-test', whoCreatedIt: '@you' });
    const beforeCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    inviteAgentToRoom({
      roomId: room.id,
      agentHandle: '@new-agent',
      agentDisplayName: 'New Agent'
    });
    const afterCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    expect(afterCount).toBe(beforeCount + 1);
    const agent = v02Agents.getLiveAgentByHandle('@new-agent');
    expect(agent?.display_name).toBe('New Agent');
  });
});

describe('inviteHumanToRoom dual-writes to v02_memberships', () => {
  it('writes a v02_memberships row when inviting a new human', () => {
    const room = createChatRoom({ name: 'human-invite', whoCreatedIt: '@you' });
    const beforeCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    inviteHumanToRoom({
      roomId: room.id,
      humanHandle: '@new-human',
      humanDisplayName: 'New Human'
    });
    const afterCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    expect(afterCount).toBe(beforeCount + 1);
  });
});

describe('removeMemberFromRoom dual-writes to v02_memberships', () => {
  it('soft-leaves the v02_memberships row when removing a member', () => {
    const room = createChatRoom({ name: 'remove-test', whoCreatedIt: '@you' });
    inviteAgentToRoom({
      roomId: room.id,
      agentHandle: '@removeable',
      agentDisplayName: 'Removeable'
    });
    expect(v02Memberships.listActiveMembershipsForRoom(room.id).length).toBe(2);
    removeMemberFromRoom({ roomId: room.id, globalHandle: '@removeable' });
    // Active count drops by 1 (the soft-leave).
    expect(v02Memberships.listActiveMembershipsForRoom(room.id).length).toBe(1);
    // Historical row preserved.
    const all = v02Memberships.listAllMembershipsForRoomIncludingHistorical(room.id);
    expect(all.length).toBe(2);
    const removed = all.find((m) => m.left_at_ms !== null);
    expect(removed).toBeDefined();
  });
});

describe('retired humanInbox dual-write path', () => {
  it('ensureHumanInboxRoom returns the deterministic id without creating hidden memberships', () => {
    const inboxId = ensureHumanInboxRoom('@you');
    const memberships = v02Memberships.listActiveMembershipsForRoom(inboxId);
    expect(memberships.length).toBe(0);
  });

  it('recomputeInboxEdge does not recreate retired hidden inbox memberships', () => {
    ensureHumanInboxRoom('@you');
    // Create a shared non-inbox room so sharedContextExists(@you, @agent)
    // returns true on the first call to recomputeInboxEdge.
    const sharedRoom = createChatRoom({ name: 'shared', whoCreatedIt: '@you' });
    inviteAgentToRoom({
      roomId: sharedRoom.id,
      agentHandle: '@inbox-agent',
      agentDisplayName: 'Inbox Agent'
    });
    // Inbox edge should already have been added by inviteAgentToRoom's
    // recomputeInboxEdgesForRoomMembershipChange. Verify it landed.
    const inboxId = ensureHumanInboxRoom('@you');
    const afterAdd = v02Memberships.listActiveMembershipsForRoom(inboxId);
    const agentInInbox = afterAdd.find(
      (m) => v02Agents.getAgentById(m.agent_id)?.primary_handle === '@inbox-agent'
    );
    expect(agentInInbox).toBeUndefined();
  });
});
