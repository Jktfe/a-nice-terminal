import type { RoomDeck } from './deckStore';

export type PublicRoomDeck = Omit<RoomDeck, 'accessPassword'>;

export function serializeDeckForApi(deck: RoomDeck): PublicRoomDeck {
  const { accessPassword: _accessPassword, ...publicDeck } = deck;
  return publicDeck;
}
