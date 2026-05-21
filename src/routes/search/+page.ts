/**
 * /search loader — runs the search on the server when ?q=... is in the URL.
 *
 * Backs M14 search-across-rooms slice 2 (page UI). The form on the page
 * submits as a plain GET to /search?q=value, so the browser navigates,
 * this loader runs server-side, and the first HTML response already
 * carries the hits — same SSR-first pattern as /chair.
 */

import type { PageLoad } from './$types';
import type { MessageSearchHit } from '$lib/server/messageSearchStore';

export const load: PageLoad = async ({ url, fetch }) => {
  const rawQuery = url.searchParams.get('q') ?? '';
  const rawRoomId = url.searchParams.get('roomId') ?? '';
  const trimmedQuery = rawQuery.trim();
  const roomId = rawRoomId.trim();

  if (trimmedQuery.length === 0) {
    return {
      queryFromServer: '',
      roomIdFromServer: roomId,
      hitsFromServer: [] as MessageSearchHit[],
      searchFetchFailed: false
    };
  }

  const encodedQuery = encodeURIComponent(trimmedQuery);
  const roomParam = roomId ? `&roomId=${encodeURIComponent(roomId)}` : '';
  const response = await fetch(`/api/search-messages?query=${encodedQuery}${roomParam}&limit=50`);

  if (!response.ok) {
    return {
      queryFromServer: trimmedQuery,
      roomIdFromServer: roomId,
      hitsFromServer: [] as MessageSearchHit[],
      searchFetchFailed: true
    };
  }

  const body = (await response.json()) as { hits: MessageSearchHit[] };
  return {
    queryFromServer: trimmedQuery,
    roomIdFromServer: roomId,
    hitsFromServer: body.hits ?? [],
    searchFetchFailed: false
  };
};
