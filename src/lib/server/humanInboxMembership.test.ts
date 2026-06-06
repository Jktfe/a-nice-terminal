import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import { createTerminalRecord, updateTerminalRecord } from './terminalRecordsStore';
import { recomputeInboxEdge } from './humanInboxMembership';
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

describe('humanInboxMembership retired hidden-inbox behaviour', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    getIdentityDb().prepare(`DELETE FROM terminal_records`).run();
  });

  it('does not create hidden inbox rows when room membership changes', () => {
    const room = createChatRoom({ name: 'shared-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });

    expect(inboxMembers('@you')).toEqual([]);
  });

  it('does not create hidden inbox rows from terminal ownership changes', () => {
    createTerminalRecord({
      sessionId: 't_owned',
      name: 'james-claude',
      handle: '@james-claude',
      createdBy: '@you'
    });
    updateTerminalRecord('t_owned', { createdBy: '@james' });

    expect(inboxMembers('@you')).toEqual([]);
    expect(inboxMembers('@james')).toEqual([]);
  });

  it('keeps direct recompute calls harmless no-ops', () => {
    recomputeInboxEdge('@you', '@codex');
    expect(inboxMembers('@you')).toEqual([]);
  });
});
