/**
 * Regression tests for the retired v0.2 chat-room dual-write paths.
 *
 * df2e77a removed v02 membership/room writes from production roster hot
 * paths. The clean roster source is room_membership + presentation; these
 * checks pin that legacy room mutations no longer repopulate v02 sidecars.
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

describe('chatRoomStore.createChatRoom no longer dual-writes to v02_memberships', () => {
  it('does not write a v02_memberships row for the human creator', () => {
    const room = createChatRoom({ name: 'm9c-test-1', whoCreatedIt: '@you' });
    const memberships = v02Memberships.listActiveMembershipsForRoom(room.id);
    expect(memberships.length).toBe(0);
  });

  it('does not write an operator v02_memberships row when the creator is a non-operator handle', () => {
    const room = createChatRoom({ name: 'm9c-test-2', whoCreatedIt: '@cv4' });
    const memberships = v02Memberships.listActiveMembershipsForRoom(room.id);
    expect(memberships.length).toBe(0);
  });

  it('does not write a v02_rooms row keyed by the legacy chat_rooms.id', () => {
    const room = createChatRoom({ name: 'm9c-test-3', whoCreatedIt: '@you' });
    const v02Room = getIdentityDb()
      .prepare(`SELECT room_id, display_name FROM rooms WHERE room_id = ?`)
      .get(room.id) as { room_id: string; display_name: string } | undefined;
    expect(v02Room).toBeUndefined();
  });
});

describe('inviteAgentToRoom no longer dual-writes to v02_memberships', () => {
  it('does not write a v02_memberships row when inviting a new agent', () => {
    const room = createChatRoom({ name: 'invite-test', whoCreatedIt: '@you' });
    const beforeCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    inviteAgentToRoom({
      roomId: room.id,
      agentHandle: '@new-agent',
      agentDisplayName: 'New Agent'
    });
    const afterCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('inviteHumanToRoom no longer dual-writes to v02_memberships', () => {
  it('does not write a v02_memberships row when inviting a new human', () => {
    const room = createChatRoom({ name: 'human-invite', whoCreatedIt: '@you' });
    const beforeCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    inviteHumanToRoom({
      roomId: room.id,
      humanHandle: '@new-human',
      humanDisplayName: 'New Human'
    });
    const afterCount = v02Memberships.listActiveMembershipsForRoom(room.id).length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('removeMemberFromRoom no longer dual-writes to v02_memberships', () => {
  it('does not create historical v02_memberships rows when removing a member', () => {
    const room = createChatRoom({ name: 'remove-test', whoCreatedIt: '@you' });
    inviteAgentToRoom({
      roomId: room.id,
      agentHandle: '@removeable',
      agentDisplayName: 'Removeable'
    });
    expect(v02Memberships.listActiveMembershipsForRoom(room.id).length).toBe(0);
    removeMemberFromRoom({ roomId: room.id, globalHandle: '@removeable' });
    expect(v02Memberships.listActiveMembershipsForRoom(room.id).length).toBe(0);
    const all = v02Memberships.listAllMembershipsForRoomIncludingHistorical(room.id);
    expect(all.length).toBe(0);
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
    expect(afterAdd).toHaveLength(0);
  });
});
