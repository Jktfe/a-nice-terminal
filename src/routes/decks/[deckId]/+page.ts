import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { RoomDeck } from '$lib/server/deckStore';

export const load: PageLoad = async ({ fetch, params, url }) => {
  const password = url.searchParams.get('password');
  const apiUrl = `/api/decks/${encodeURIComponent(params.deckId)}` +
    (password ? `?password=${encodeURIComponent(password)}` : '');

  const response = await fetch(apiUrl);
  if (!response.ok) {
    if (response.status === 404) throw error(404, 'Deck not found.');
    if (response.status === 403) throw error(403, 'Access denied — room membership or deck password required.');
    throw error(response.status, `Could not load deck (${response.status}).`);
  }
  const body = (await response.json()) as { deck: RoomDeck };
  return { deck: body.deck };
};
