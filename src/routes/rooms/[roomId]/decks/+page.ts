import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { RoomDeck } from '$lib/server/deckStore';

export const load: PageLoad = async ({ fetch, params }) => {
  const response = await fetch(`/api/chat-rooms/${encodeURIComponent(params.roomId)}/decks`);
  if (!response.ok) {
    if (response.status === 404) throw error(404, 'Room not found.');
    throw error(response.status, `Could not load room decks (${response.status}).`);
  }
  const body = (await response.json()) as { decks: RoomDeck[] };
  return {
    roomId: params.roomId,
    decks: body.decks ?? []
  };
};
