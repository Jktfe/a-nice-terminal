/**
 * deckStore tests — Task #126 v3-parity.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDeck,
  listDecksInRoom,
  getDeck,
  updateDeck,
  softDeleteDeck,
  resetDeckStoreForTests
} from './deckStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';

beforeEach(() => {
  resetDeckStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetDeckStoreForTests();
  resetChatRoomStoreForTests();
});

function makeRoom(name = 'test-room') {
  return createChatRoom({ name, whoCreatedIt: 'test' });
}

describe('createDeck', () => {
  it('creates a deck with minimal fields', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Pitch' });
    expect(deck.title).toBe('Pitch');
    expect(deck.slides).toEqual([]);
    expect(deck.roomId).toBe(room.id);
    expect(deck.createdAtMs).toBeGreaterThan(0);
    expect(deck.updatedAtMs).toBe(deck.createdAtMs);
  });

  it('creates a deck with slides', () => {
    const room = makeRoom();
    const slides = [{ id: 's1', title: 'Slide 1', content: 'Hello' }];
    const deck = createDeck({ roomId: room.id, title: 'Pitch', slides });
    expect(deck.slides.length).toBe(1);
    expect(deck.slides[0].title).toBe('Slide 1');
  });

  it('normalizes imported body-only slides for the deck viewer', () => {
    const room = makeRoom();
    const deck = createDeck({
      roomId: room.id,
      title: 'Imported',
      slides: [{ title: 'Slide 1', body: 'Hello from body' } as unknown as NonNullable<Parameters<typeof createDeck>[0]['slides']>[number]]
    });

    const found = getDeck(deck.id);
    expect(found!.slides[0]).toMatchObject({
      id: 'slide-1',
      title: 'Slide 1',
      content: 'Hello from body'
    });
  });

  it('trims title', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: '  Trimmed  ' });
    expect(deck.title).toBe('Trimmed');
  });

  it('rejects blank title', () => {
    const room = makeRoom();
    expect(() => createDeck({ roomId: room.id, title: '   ' })).toThrow('title cannot be blank');
  });
});

describe('listDecksInRoom', () => {
  it('lists decks newest-first', async () => {
    const room = makeRoom();
    const d1 = createDeck({ roomId: room.id, title: 'A' });
    await new Promise(r => setTimeout(r, 10));
    const d2 = createDeck({ roomId: room.id, title: 'B' });
    const decks = listDecksInRoom(room.id);
    expect(decks.length).toBe(2);
    expect(decks[0].id).toBe(d2.id);
    expect(decks[1].id).toBe(d1.id);
  });

  it('excludes soft-deleted decks', () => {
    const room = makeRoom();
    const d1 = createDeck({ roomId: room.id, title: 'A' });
    createDeck({ roomId: room.id, title: 'B' });
    softDeleteDeck(d1.id);
    const decks = listDecksInRoom(room.id);
    expect(decks.length).toBe(1);
    expect(decks[0].title).toBe('B');
  });

  it('returns empty for unknown room', () => {
    expect(listDecksInRoom('unknown')).toEqual([]);
  });
});

describe('getDeck', () => {
  it('returns a deck by id', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Find me' });
    const found = getDeck(deck.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Find me');
  });

  it('returns undefined for unknown id', () => {
    expect(getDeck('no-such-id')).toBeUndefined();
  });

  it('returns undefined for soft-deleted deck', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Gone' });
    softDeleteDeck(deck.id);
    expect(getDeck(deck.id)).toBeUndefined();
  });
});

describe('updateDeck', () => {
  it('updates title and slides', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Old', slides: [{ id: 's1', title: 'S', content: 'c' }] });
    const updated = updateDeck(deck.id, {
      title: 'New',
      slides: [{ id: 's2', title: 'S2', content: 'c2' }]
    });
    expect(updated!.title).toBe('New');
    expect(updated!.slides.length).toBe(1);
    expect(updated!.slides[0].title).toBe('S2');
  });

  it('rejects blank title', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Old' });
    expect(() => updateDeck(deck.id, { title: '   ' })).toThrow('title cannot be blank');
  });

  it('returns undefined for unknown id', () => {
    expect(updateDeck('no-such-id', { title: 'X' })).toBeUndefined();
  });
});

describe('softDeleteDeck', () => {
  it('soft-deletes an existing deck', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Delete me' });
    expect(softDeleteDeck(deck.id)).toBe(true);
    expect(getDeck(deck.id)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    expect(softDeleteDeck('no-such-id')).toBe(false);
  });

  it('returns false for already deleted deck', () => {
    const room = makeRoom();
    const deck = createDeck({ roomId: room.id, title: 'Gone' });
    softDeleteDeck(deck.id);
    expect(softDeleteDeck(deck.id)).toBe(false);
  });
});
