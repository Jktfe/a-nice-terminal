import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  findLatestBreakPostOrder,
  listMessagesAfterLatestBreak,
  listMessagesInRoom,
  listMessagesPageInRoom,
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

  it('findLatestBreakPostOrder returns null when no break exists', () => {
    const room = createChatRoom({ name: 'no-break-2', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'a' });
    expect(findLatestBreakPostOrder(room.id)).toBeNull();
  });

  it('findLatestBreakPostOrder returns the most recent break post_order', () => {
    const room = createChatRoom({ name: 'find-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'first' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'mid' });
    const second = postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'second' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'post' });

    expect(findLatestBreakPostOrder(room.id)).toBe(second.postOrder);
  });

  it('listMessagesPageInRoom with sinceBreak=true returns break + post-break only', () => {
    const room = createChatRoom({ name: 'page-since-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-1' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-2' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'post-1' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'post-2' });

    const page = listMessagesPageInRoom({ roomId: room.id, limit: 100, sinceBreak: true });
    const bodies = page.messages.map((m) => m.body);
    expect(bodies).not.toContain('pre-1');
    expect(bodies).not.toContain('pre-2');
    expect(bodies).toContain('post-1');
    expect(bodies).toContain('post-2');
  });

  it('listMessagesPageInRoom without sinceBreak returns full history (legacy behaviour)', () => {
    const room = createChatRoom({ name: 'page-full', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'pre-1' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'post-1' });

    const page = listMessagesPageInRoom({ roomId: room.id, limit: 100 });
    expect(page.messages).toHaveLength(3);
  });

  it('listMessagesPageInRoom with sinceBreak=true and no break returns everything', () => {
    const room = createChatRoom({ name: 'page-no-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'only' });

    const page = listMessagesPageInRoom({ roomId: room.id, limit: 100, sinceBreak: true });
    expect(page.messages.map((m) => m.body)).toEqual(['only']);
  });
});
