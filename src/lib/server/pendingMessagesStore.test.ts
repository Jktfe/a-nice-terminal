import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from './chatMessageStore';
import {
  listPendingForHandle,
  listChasingForHandle
} from './pendingMessagesStore';
import { getIdentityDb } from './db';

/** Helper that bumps a single message's posted_at back by N minutes so we
 *  can assert chasing's idle floor without sleeping. */
function ageMessageByMinutes(messageId: string, minutes: number): void {
  const db = getIdentityDb();
  const olderIso = new Date(Date.now() - minutes * 60_000).toISOString();
  db.prepare(`UPDATE chat_messages SET posted_at = ? WHERE id = ?`).run(olderIso, messageId);
}

describe('pendingMessagesStore', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('listPendingForHandle returns [] when nothing has been posted', () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@me' });
    expect(room.members.map((m) => m.handle)).toContain('@me');
    expect(listPendingForHandle('@me')).toEqual([]);
  });

  it('listPendingForHandle returns a mention from another author when I have not replied', () => {
    const room = createChatRoom({ name: 'mentions', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const mention = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: 'hey @me what do you think?'
    });
    const pending = listPendingForHandle('@me');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(mention.id);
    expect(pending[0].authorHandle).toBe('@codex');
  });

  it('listPendingForHandle filters out mentions I have threaded a reply to', () => {
    const room = createChatRoom({ name: 'replied', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const mention = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: 'pinging @me'
    });
    postMessage({
      roomId: room.id,
      authorHandle: '@me',
      body: 'on it',
      parentMessageId: mention.id
    });
    expect(listPendingForHandle('@me')).toEqual([]);
  });

  it('listPendingForHandle ignores messages I posted myself + non-mentions', () => {
    const room = createChatRoom({ name: 'mixed', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    postMessage({ roomId: room.id, authorHandle: '@me', body: 'hey @me self note' });
    postMessage({ roomId: room.id, authorHandle: '@codex', body: 'unrelated chatter' });
    expect(listPendingForHandle('@me')).toEqual([]);
  });

  it('listPendingForHandle scopes to rooms I am a member of (multi-room)', () => {
    const myRoom = createChatRoom({ name: 'mine', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: myRoom.id, agentHandle: '@codex' });
    const otherRoom = createChatRoom({ name: 'theirs', whoCreatedIt: '@someone-else' });
    inviteAgentToRoom({ roomId: otherRoom.id, agentHandle: '@codex' });
    postMessage({ roomId: myRoom.id, authorHandle: '@codex', body: '@me ping' });
    postMessage({ roomId: otherRoom.id, authorHandle: '@codex', body: '@me ping in other room' });
    const pending = listPendingForHandle('@me');
    expect(pending).toHaveLength(1);
    expect(pending[0].roomId).toBe(myRoom.id);
  });

  it('listPendingForHandle honours the sinceMs floor', () => {
    const room = createChatRoom({ name: 'time-filter', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const older = postMessage({ roomId: room.id, authorHandle: '@codex', body: 'old @me ping' });
    ageMessageByMinutes(older.id, 60); // 60 min ago
    const newer = postMessage({ roomId: room.id, authorHandle: '@codex', body: 'fresh @me ping' });
    const cutoff = Date.now() - 5 * 60_000;
    const pending = listPendingForHandle('@me', cutoff);
    expect(pending.map((m) => m.id)).toEqual([newer.id]);
  });

  it('listChasingForHandle is empty when someone else replied last', () => {
    const room = createChatRoom({ name: 'fresh-reply', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    postMessage({ roomId: room.id, authorHandle: '@me', body: 'thoughts?' });
    postMessage({ roomId: room.id, authorHandle: '@codex', body: 'yeah heres mine' });
    expect(listChasingForHandle('@me', 0)).toEqual([]);
  });

  it('listChasingForHandle returns the trailing message after the idle floor', () => {
    const room = createChatRoom({ name: 'idle', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    postMessage({ roomId: room.id, authorHandle: '@codex', body: 'go ahead' });
    const mine = postMessage({ roomId: room.id, authorHandle: '@me', body: 'still need a hand here' });
    ageMessageByMinutes(mine.id, 45);
    const chasing = listChasingForHandle('@me', 30);
    expect(chasing).toHaveLength(1);
    expect(chasing[0].id).toBe(mine.id);
  });

  it('listChasingForHandle skips threads still inside the idle floor', () => {
    const room = createChatRoom({ name: 'still-warm', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    postMessage({ roomId: room.id, authorHandle: '@codex', body: 'go ahead' });
    postMessage({ roomId: room.id, authorHandle: '@me', body: 'just spoke' });
    expect(listChasingForHandle('@me', 30)).toEqual([]);
  });

  it('listChasingForHandle scopes to my rooms (multi-room)', () => {
    const myRoom = createChatRoom({ name: 'mine', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: myRoom.id, agentHandle: '@codex' });
    const otherRoom = createChatRoom({ name: 'not-mine', whoCreatedIt: '@stranger' });
    inviteAgentToRoom({ roomId: otherRoom.id, agentHandle: '@codex' });
    const mine = postMessage({ roomId: myRoom.id, authorHandle: '@me', body: 'mine, idle' });
    ageMessageByMinutes(mine.id, 60);
    // Other room: '@me' is NOT a member; even though I posted last via a
    // direct postMessage call, my membership check excludes the row.
    const otherIdle = postMessage({ roomId: otherRoom.id, authorHandle: '@me', body: 'foreign room' });
    ageMessageByMinutes(otherIdle.id, 60);
    const chasing = listChasingForHandle('@me', 30);
    expect(chasing.map((m) => m.roomId)).toEqual([myRoom.id]);
  });
});
