import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  removeMemberFromRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import { createTerminalRecord, updateTerminalRecord } from './terminalRecordsStore';
import { inboxRoomIdFor } from './humanInboxRoomStore';
import { getIdentityDb } from './db';

function inboxMembers(humanHandle: string): string[] {
  const db = getIdentityDb();
  const inboxId = inboxRoomIdFor(humanHandle);
  return (
    db.prepare(`SELECT handle FROM chat_room_members WHERE room_id = ? ORDER BY handle`)
      .all(inboxId) as Array<{ handle: string }>
  ).map((row) => row.handle);
}

describe('humanInboxMembership', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    // Also wipe terminal_records — resetChatRoomStoreForTests doesn't, and
    // these tests reuse session_id strings across cases.
    getIdentityDb().prepare(`DELETE FROM terminal_records`).run();
  });

  describe('path (a) — shared chat-room membership', () => {
    it('agent joining a room with a human → added to that human\'s inbox', () => {
      const room = createChatRoom({ name: 'shared-room', whoCreatedIt: '@you' });
      expect(inboxMembers('@you')).toEqual(['@you']);
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
      expect(inboxMembers('@you')).toEqual(['@codex', '@you']);
    });

    it('agent leaving the LAST shared room → removed from inbox', () => {
      const r1 = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: r1.id, agentHandle: '@codex' });
      expect(inboxMembers('@you')).toContain('@codex');
      removeMemberFromRoom({ roomId: r1.id, globalHandle: '@codex' });
      expect(inboxMembers('@you')).toEqual(['@you']);
    });

    it('agent leaving a shared room while ANOTHER shared room remains → stays in inbox', () => {
      const r1 = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
      const r2 = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: r1.id, agentHandle: '@codex' });
      inviteAgentToRoom({ roomId: r2.id, agentHandle: '@codex' });
      expect(inboxMembers('@you')).toContain('@codex');
      removeMemberFromRoom({ roomId: r1.id, globalHandle: '@codex' });
      // Still in r2 with @you → inbox membership persists.
      expect(inboxMembers('@you')).toContain('@codex');
      removeMemberFromRoom({ roomId: r2.id, globalHandle: '@codex' });
      // Now no shared rooms left → gone.
      expect(inboxMembers('@you')).not.toContain('@codex');
    });
  });

  describe('path (b) — terminal ownership', () => {
    it('createTerminalRecord with createdBy + handle → agent added to owner\'s inbox', () => {
      // Pre-seed @you's inbox by creating a room they own.
      createChatRoom({ name: 'seed', whoCreatedIt: '@you' });
      expect(inboxMembers('@you')).toEqual(['@you']);
      createTerminalRecord({
        sessionId: 't_owned',
        name: 'james-claude',
        handle: '@james-claude',
        createdBy: '@you'
      });
      expect(inboxMembers('@you')).toEqual(['@james-claude', '@you']);
    });

    it('agent owned by @you stays in inbox even with NO shared chat rooms', () => {
      createChatRoom({ name: 'seed', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_solo',
        name: 'solo-agent',
        handle: '@solo',
        createdBy: '@you'
      });
      // No room invite happened — but path (b) keeps the inbox edge.
      expect(inboxMembers('@you')).toContain('@solo');
    });

    it('updateTerminalRecord clearing createdBy + no shared rooms → agent removed from inbox', () => {
      createChatRoom({ name: 'seed', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_transfer',
        name: 'transfer-target',
        handle: '@xfer',
        createdBy: '@you'
      });
      expect(inboxMembers('@you')).toContain('@xfer');
      updateTerminalRecord('t_transfer', { createdBy: null });
      expect(inboxMembers('@you')).not.toContain('@xfer');
    });

    it('transferring ownership from @you → @james: @you loses edge (no other path), @james gains it', () => {
      createChatRoom({ name: 'seed-you', whoCreatedIt: '@you' });
      createChatRoom({ name: 'seed-james', whoCreatedIt: '@james' });
      createTerminalRecord({
        sessionId: 't_transfer',
        name: 't',
        handle: '@xfer',
        createdBy: '@you'
      });
      expect(inboxMembers('@you')).toContain('@xfer');
      expect(inboxMembers('@james')).not.toContain('@xfer');
      updateTerminalRecord('t_transfer', { createdBy: '@james' });
      expect(inboxMembers('@you')).not.toContain('@xfer');
      expect(inboxMembers('@james')).toContain('@xfer');
    });
  });

  describe('path (a) AND path (b) — both true, then one drops', () => {
    it('agent in both shared-room AND owned-terminal: dropping one keeps inbox edge', () => {
      const room = createChatRoom({ name: 'shared', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_both',
        name: 't',
        handle: '@both',
        createdBy: '@you'
      });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@both' });
      expect(inboxMembers('@you')).toContain('@both');
      // Drop path (a): leave the shared room.
      removeMemberFromRoom({ roomId: room.id, globalHandle: '@both' });
      // Path (b) still holds → stays in inbox.
      expect(inboxMembers('@you')).toContain('@both');
      // Drop path (b) too: clear terminal ownership.
      updateTerminalRecord('t_both', { createdBy: null });
      // Now neither path → gone.
      expect(inboxMembers('@you')).not.toContain('@both');
    });
  });

  describe('isolation', () => {
    it('an agent only in @james\'s room is NOT in @you\'s inbox (no shared context)', () => {
      // Use a non-@you owner so the createChatRoom @you-auto-add doesn't
      // give @you visibility. Then create an agent only in @james's room.
      const room = createChatRoom({ name: 'james-room', whoCreatedIt: '@james' });
      // createChatRoom auto-adds @you per Task #138, so @you DOES see this
      // room. To prove isolation, REMOVE @you first.
      removeMemberFromRoom({ roomId: room.id, globalHandle: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@james-only' });
      expect(inboxMembers('@james')).toContain('@james-only');
      expect(inboxMembers('@you')).not.toContain('@james-only');
    });
  });
});
