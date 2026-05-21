import { describe, expect, it } from 'vitest';
import { serializeDeckForApi } from './deckApi';
import type { RoomDeck } from './deckStore';

describe('deckApi', () => {
  it('strips accessPassword from deck', () => {
    const deck: RoomDeck = {
      id: 'deck-1',
      roomId: 'room-1',
      title: 'My Deck',
      slides: [],
      theme: null,
      createdBy: '@you',
      accessPassword: 'secret123',
      createdAtMs: 1,
      updatedAtMs: 2
    };
    const publicDeck = serializeDeckForApi(deck);
    expect(publicDeck).not.toHaveProperty('accessPassword');
    expect(publicDeck.id).toBe('deck-1');
    expect(publicDeck.roomId).toBe('room-1');
    expect(publicDeck.title).toBe('My Deck');
    expect(publicDeck.slides).toEqual([]);
    expect(publicDeck.createdAtMs).toBe(1);
    expect(publicDeck.updatedAtMs).toBe(2);
  });

  it('works when accessPassword is empty string', () => {
    const deck: RoomDeck = {
      id: 'deck-2',
      roomId: 'room-2',
      title: 'Open Deck',
      slides: [],
      theme: 'default',
      createdBy: null,
      accessPassword: '',
      createdAtMs: 1,
      updatedAtMs: null
    };
    const publicDeck = serializeDeckForApi(deck);
    expect(publicDeck).not.toHaveProperty('accessPassword');
    expect(publicDeck.title).toBe('Open Deck');
    expect(publicDeck.theme).toBe('default');
  });

  it('works when accessPassword is null', () => {
    const deck: RoomDeck = {
      id: 'deck-3',
      roomId: 'room-3',
      title: 'Null Pass',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }],
      theme: null,
      createdBy: null,
      accessPassword: null,
      createdAtMs: 1,
      updatedAtMs: null
    };
    const publicDeck = serializeDeckForApi(deck);
    expect(publicDeck).not.toHaveProperty('accessPassword');
    expect(publicDeck.slides).toHaveLength(1);
  });
});
