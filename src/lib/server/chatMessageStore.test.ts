import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  listMessagesPageInRoom,
  listMessagesInRoom,
  postBreakMessage,
  postMessage,
  postSystemMessage,
  softDeleteMessage,
  getMessageById,
  resetChatMessageStoreForTests
} from './chatMessageStore';

describe('chatMessageStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('postMessage adds a message to the room', () => {
    const room = createChatRoom({ name: 'message-host', whoCreatedIt: '@you' });
    const posted = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'Hello team.'
    });
    expect(posted.body).toBe('Hello team.');
    expect(posted.roomId).toBe(room.id);
    expect(posted.kind).toBe('human');
    expect(listMessagesInRoom(room.id)).toHaveLength(1);
  });

  it('postMessage trims whitespace from the body', () => {
    const room = createChatRoom({ name: 'trim-test', whoCreatedIt: '@you' });
    const posted = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: '   spaces around   '
    });
    expect(posted.body).toBe('spaces around');
  });

  it('postMessage rejects a blank body', () => {
    const room = createChatRoom({ name: 'blank-body', whoCreatedIt: '@you' });
    expect(() =>
      postMessage({ roomId: room.id, authorHandle: '@you', body: '   ' })
    ).toThrow();
  });

  it('postMessage refuses an unknown room', () => {
    expect(() =>
      postMessage({ roomId: 'room_does_not_exist', authorHandle: '@you', body: 'hi' })
    ).toThrow();
  });

  it('postSystemMessage adds a message with kind system', () => {
    const room = createChatRoom({ name: 'system-host', whoCreatedIt: '@you' });
    const posted = postSystemMessage({
      roomId: room.id,
      body: '@evolveantclaude joined this room.'
    });
    expect(posted.kind).toBe('system');
    expect(posted.authorHandle).toBe('@system');
  });

  it('postSystemMessage rejects a blank body', () => {
    const room = createChatRoom({ name: 'blank-system', whoCreatedIt: '@you' });
    expect(() => postSystemMessage({ roomId: room.id, body: '   ' })).toThrow();
  });

  it('listMessagesInRoom returns messages in post order', () => {
    const room = createChatRoom({ name: 'order-test', whoCreatedIt: '@you' });
    const first = postMessage({ roomId: room.id, authorHandle: '@you', body: 'first' });
    const second = postMessage({ roomId: room.id, authorHandle: '@you', body: 'second' });
    const third = postMessage({ roomId: room.id, authorHandle: '@you', body: 'third' });

    const list = listMessagesInRoom(room.id);
    expect(list.map((m) => m.id)).toEqual([first.id, second.id, third.id]);
  });

  it('listMessagesInRoom returns an empty array for a room with no messages', () => {
    const room = createChatRoom({ name: 'empty-room', whoCreatedIt: '@you' });
    expect(listMessagesInRoom(room.id)).toEqual([]);
  });

  it('listMessagesPageInRoom returns the newest page oldest-first with a hasMore cursor', () => {
    const room = createChatRoom({ name: 'page-room', whoCreatedIt: '@you' });
    const first = postMessage({ roomId: room.id, authorHandle: '@you', body: 'first' });
    const second = postMessage({ roomId: room.id, authorHandle: '@you', body: 'second' });
    const third = postMessage({ roomId: room.id, authorHandle: '@you', body: 'third' });
    const fourth = postMessage({ roomId: room.id, authorHandle: '@you', body: 'fourth' });

    const page = listMessagesPageInRoom({ roomId: room.id, limit: 2 });

    expect(page.messages.map((message) => message.id)).toEqual([third.id, fourth.id]);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe(third.postOrder);

    const older = listMessagesPageInRoom({
      roomId: room.id,
      limit: 2,
      beforePostOrder: page.nextBefore ?? undefined
    });
    expect(older.messages.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(older.hasMore).toBe(false);
    expect(older.nextBefore).toBeNull();
  });

  // M30 threading slice 1 — store-only data model for parentMessageId.
  // Endpoint and UI exposure are deferred to slices 2 and 3 respectively.
  describe('slice 1 parentMessageId pass-through (store-only)', () => {
    it('default callers (no parentMessageId) produce messages without the field (zero drift)', () => {
      const room = createChatRoom({ name: 'no-parent', whoCreatedIt: '@you' });
      const message = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'standalone'
      });
      expect(message.parentMessageId).toBeUndefined();
      expect('parentMessageId' in message).toBe(false);
    });

    it('postMessage persists parentMessageId verbatim when provided', () => {
      const room = createChatRoom({ name: 'has-parent', whoCreatedIt: '@you' });
      const parent = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'first'
      });
      const reply = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'reply',
        parentMessageId: parent.id
      });
      expect(reply.parentMessageId).toBe(parent.id);
    });

    it('parentMessageId is preserved through listMessagesInRoom', () => {
      const room = createChatRoom({ name: 'thread-list', whoCreatedIt: '@you' });
      const parent = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'parent'
      });
      postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'child',
        parentMessageId: parent.id
      });
      const stored = listMessagesInRoom(room.id);
      expect(stored).toHaveLength(2);
      expect(stored[0].parentMessageId).toBeUndefined();
      expect(stored[1].parentMessageId).toBe(parent.id);
    });

    it('store layer is permissive: unknown parentMessageId still persists (validation is endpoint-level in slice 2)', () => {
      const room = createChatRoom({ name: 'permissive', whoCreatedIt: '@you' });
      const reply = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'dangling parent',
        parentMessageId: 'msg_nonexistent'
      });
      expect(reply.parentMessageId).toBe('msg_nonexistent');
      const stored = listMessagesInRoom(room.id);
      expect(stored[0].parentMessageId).toBe('msg_nonexistent');
    });

    it('postSystemMessage and postBreakMessage do not accept parentMessageId (root-level by construction)', () => {
      const room = createChatRoom({ name: 'system-root', whoCreatedIt: '@you' });
      const sys = postSystemMessage({ roomId: room.id, body: 'joined' });
      expect(sys.parentMessageId).toBeUndefined();
      const breakMsg = postBreakMessage({
        roomId: room.id,
        reason: 'context reset',
        postedByHandle: '@you'
      });
      expect(breakMsg.parentMessageId).toBeUndefined();
    });
  });

  describe('M3.4b T2: discussion_id field on ChatMessage', () => {
    it('persists discussion_id verbatim when provided', () => {
      const room = createChatRoom({ name: 'r-disc', whoCreatedIt: '@you' });
      const m = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'in discussion',
        discussion_id: 'disc_abc'
      });
      expect(m.discussion_id).toBe('disc_abc');
    });

    it('omits discussion_id when not provided', () => {
      const room = createChatRoom({ name: 'r-no-disc', whoCreatedIt: '@you' });
      const m = postMessage({ roomId: room.id, authorHandle: '@you', body: 'root' });
      expect(m.discussion_id).toBeUndefined();
      expect('discussion_id' in m).toBe(false);
    });

    it('orthogonal: can carry BOTH parentMessageId AND discussion_id', () => {
      const room = createChatRoom({ name: 'r-both', whoCreatedIt: '@you' });
      const parent = postMessage({ roomId: room.id, authorHandle: '@you', body: 'parent' });
      const child = postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'child in discussion',
        parentMessageId: parent.id,
        discussion_id: 'disc_xyz'
      });
      expect(child.parentMessageId).toBe(parent.id);
      expect(child.discussion_id).toBe('disc_xyz');
    });
  });
});

describe('softDeleteMessage — operator override + purge (JWPK msg_3535ek7e5p)', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('operator can delete another author and PURGES the body from search', () => {
    const room = createChatRoom({ name: 'op-del', whoCreatedIt: '@you' });
    const agentMsg = postMessage({ roomId: room.id, authorHandle: '@some-agent', body: 'chatty noise' });

    const deleted = softDeleteMessage({
      messageId: agentMsg.id,
      byHandle: '@you',
      asOperator: true
    });

    expect(deleted).not.toBeNull();
    expect(deleted?.deletedAtMs).toBeTruthy();
    expect(deleted?.deletedByHandle).toBe('@you');
    // body purged so it no longer pollutes search; tombstone stays.
    expect(deleted?.body).toBe('');
    expect(getMessageById(agentMsg.id)?.body).toBe('');
  });

  it('a non-operator cannot delete another author (rejected)', () => {
    const room = createChatRoom({ name: 'no-del', whoCreatedIt: '@you' });
    const agentMsg = postMessage({ roomId: room.id, authorHandle: '@some-agent', body: 'keep me' });

    const result = softDeleteMessage({
      messageId: agentMsg.id,
      byHandle: '@other-agent',
      asOperator: false
    });

    expect(result).toBeNull();
    expect(getMessageById(agentMsg.id)?.body).toBe('keep me');
    expect(getMessageById(agentMsg.id)?.deletedAtMs ?? null).toBeNull();
  });

  it('an author deleting their own message keeps the body (tombstone only)', () => {
    const room = createChatRoom({ name: 'own-del', whoCreatedIt: '@you' });
    const mine = postMessage({ roomId: room.id, authorHandle: '@some-agent', body: 'my words' });

    const deleted = softDeleteMessage({ messageId: mine.id, byHandle: '@some-agent' });

    expect(deleted?.deletedAtMs).toBeTruthy();
    expect(deleted?.body).toBe('my words');
  });
});
