import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  listMessagesAfterLatestBreak,
  listMessagesInRoom,
  postBreakMessage,
  postMessage,
  resetChatMessageStoreForTests
} from './chatMessageStore';
import { getIdentityDb } from './db';

describe('chatMessageStore — break context (M12)', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('postBreakMessage adds a system-break message with the reason inline', () => {
    const room = createChatRoom({ name: 'break-host', whoCreatedIt: '@you' });
    const breakMessage = postBreakMessage({
      roomId: room.id,
      reason: 'sprint changeover',
      postedByHandle: '@evolveantclaude'
    });
    expect(breakMessage.kind).toBe('system-break');
    expect(breakMessage.authorHandle).toBe('@system');
    expect(breakMessage.body).toContain('Context break');
    expect(breakMessage.body).toContain('@evolveantclaude');
    expect(breakMessage.body).toContain('sprint changeover');
  });

  it('postBreakMessage works without a reason', () => {
    const room = createChatRoom({ name: 'break-no-reason', whoCreatedIt: '@you' });
    const breakMessage = postBreakMessage({
      roomId: room.id,
      postedByHandle: '@evolveantclaude'
    });
    expect(breakMessage.kind).toBe('system-break');
    expect(breakMessage.body).not.toContain(':');
  });

  it('postBreakMessage refuses an unknown room', () => {
    expect(() =>
      postBreakMessage({ roomId: 'does_not_exist', postedByHandle: '@you' })
    ).toThrow();
  });

  it('listMessagesInRoom still returns the break and surrounding messages', () => {
    const room = createChatRoom({ name: 'mixed', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'before' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'after' });
    const everything = listMessagesInRoom(room.id);
    expect(everything).toHaveLength(3);
    expect(everything.map((m) => m.kind)).toEqual(['human', 'system-break', 'human']);
  });

  it('listMessagesAfterLatestBreak returns break + post-break only', () => {
    const room = createChatRoom({ name: 'agent-view', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-break-1' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-break-2' });
    const breakMessage = postBreakMessage({ roomId: room.id, postedByHandle: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'post-break-1' });

    const agentVisible = listMessagesAfterLatestBreak(room.id);
    expect(agentVisible.map((m) => m.body)).toEqual([
      breakMessage.body,
      'post-break-1'
    ]);
  });

  it('listMessagesAfterLatestBreak returns everything when no break has been posted', () => {
    const room = createChatRoom({ name: 'no-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'lonely' });
    const agentVisible = listMessagesAfterLatestBreak(room.id);
    expect(agentVisible).toHaveLength(1);
    expect(agentVisible[0].body).toBe('lonely');
  });

  it('listMessagesAfterLatestBreak uses the MOST RECENT break when more than one exists', () => {
    const room = createChatRoom({ name: 'double-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'oldest' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'first' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'middle' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'second' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'latest' });

    const agentVisible = listMessagesAfterLatestBreak(room.id);
    expect(agentVisible.map((m) => m.body)).toEqual([
      expect.stringContaining('second'),
      'latest'
    ]);
  });

  it('listMessagesAfterLatestBreak ignores deleted breaks when choosing the boundary', () => {
    const room = createChatRoom({ name: 'deleted-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'oldest' });
    const firstBreak = postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'first' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'middle' });
    const secondBreak = postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'second' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'latest' });

    getIdentityDb()
      .prepare(`UPDATE chat_messages SET deleted_at_ms = ?, deleted_by_handle = ? WHERE id = ?`)
      .run(1234, '@you', secondBreak.id);

    const agentVisible = listMessagesAfterLatestBreak(room.id);
    expect(agentVisible.map((m) => m.body)).toEqual([
      firstBreak.body,
      'middle',
      secondBreak.body,
      'latest'
    ]);
  });
});
