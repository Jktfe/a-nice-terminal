import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import {
  postBreakMessage,
  postMessage,
  postSystemMessage,
  resetChatMessageStoreForTests
} from './chatMessageStore';
import { searchMessages } from './messageSearchStore';

describe('messageSearchStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('finds a message whose body contains the query (case-insensitive)', () => {
    const room = createChatRoom({ name: 'demo', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Let us ship the FRESH ant build' });
    const hits = searchMessages({ query: 'fresh ant' });
    expect(hits).toHaveLength(1);
    expect(hits[0].message.body).toContain('FRESH ant');
    expect(hits[0].roomName).toBe('demo');
    expect(hits[0].roomId).toBe(room.id);
  });

  it('returns matching messages newest-first across all rooms', () => {
    const roomA = createChatRoom({ name: 'room A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'room B', whoCreatedIt: '@you' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'fish chips' });
    postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'chips and gravy' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'chips later' });

    const hits = searchMessages({ query: 'chips' });
    expect(hits.map((hit) => hit.message.body)).toEqual([
      'chips later',
      'chips and gravy',
      'fish chips'
    ]);
  });

  it('scopes results to one room when roomId is provided', () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'pizza' });
    postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'pizza' });

    const hits = searchMessages({ query: 'pizza', roomId: roomA.id });
    expect(hits).toHaveLength(1);
    expect(hits[0].roomId).toBe(roomA.id);
  });

  it('can scope a room search to the current block after the latest break', () => {
    const room = createChatRoom({ name: 'Block Room', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'needle before break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'new block' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'needle after break' });

    const hits = searchMessages({
      query: 'needle',
      roomId: room.id,
      afterLatestBreakOnly: true
    });

    expect(hits.map((hit) => hit.message.body)).toEqual(['needle after break']);
  });

  it('leaves full-room search available when the current-block option is not set', () => {
    const room = createChatRoom({ name: 'Full Room', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'archiveword before break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'new block' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'archiveword after break' });

    const hits = searchMessages({ query: 'archiveword', roomId: room.id });

    expect(hits.map((hit) => hit.message.body)).toEqual([
      'archiveword after break',
      'archiveword before break'
    ]);
  });

  it('matches system and break messages too (they live in the same store)', () => {
    const room = createChatRoom({ name: 'with-system', whoCreatedIt: '@you' });
    postSystemMessage({ roomId: room.id, body: '@kimi joined the room' });
    const hits = searchMessages({ query: 'kimi' });
    expect(hits).toHaveLength(1);
    expect(hits[0].message.kind).toBe('system');
  });

  it('rejects an empty query', () => {
    expect(() => searchMessages({ query: '   ' })).toThrow();
  });

  it('throws on an unknown roomId', () => {
    expect(() =>
      searchMessages({ query: 'anything', roomId: 'does_not_exist' })
    ).toThrow();
  });

  it('returns an empty list when nothing matches', () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello world' });
    const hits = searchMessages({ query: 'banana' });
    expect(hits).toEqual([]);
  });

  it('applies a default limit and caps very large limits', () => {
    const room = createChatRoom({ name: 'lots', whoCreatedIt: '@you' });
    for (let index = 0; index < 60; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }

    const defaultLimit = searchMessages({ query: 'match' });
    expect(defaultLimit).toHaveLength(50);

    const capped = searchMessages({ query: 'match', limit: 99_999 });
    expect(capped.length).toBeLessThanOrEqual(200);
  });

  it('honours a small explicit limit', () => {
    const room = createChatRoom({ name: 'few', whoCreatedIt: '@you' });
    for (let index = 0; index < 10; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const hits = searchMessages({ query: 'match', limit: 3 });
    expect(hits).toHaveLength(3);
  });

  it('falls back to the default limit when a non-positive limit is passed', () => {
    const room = createChatRoom({ name: 'fallback', whoCreatedIt: '@you' });
    for (let index = 0; index < 5; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const hits = searchMessages({ query: 'match', limit: -1 });
    expect(hits).toHaveLength(5);
  });

  it('returns an empty list when there are no rooms at all', () => {
    const hits = searchMessages({ query: 'anything' });
    expect(hits).toEqual([]);
  });
});
