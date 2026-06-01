/**
 * GET /api/decks/:deckId — cross-room deck lookup with access control.
 *
 * Companion to /api/chat-rooms/:roomId/decks/ (which scopes by room).
 * This endpoint resolves a deck by id alone so a shareable /decks/:id
 * URL works for recipients who arrived from a link rather than from
 * inside the source room.
 *
 * Access control:
 *   - Room members (via ant_browser_session cookie) see the deck freely.
 *   - Anyone with ?password= matching deck.access_password also sees it.
 *   - Otherwise 403.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { resolveDeckAccess } from '$lib/server/deckAccessGate';
import { serializeDeckForApi } from '$lib/server/deckApi';

export const GET: RequestHandler = ({ params, request, url }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const access = resolveDeckAccess({
    deckRoomId: deck.roomId,
    deckAccessPassword: deck.accessPassword,
    request,
    url
  });

  if (!access.allowed) {
    throw error(403, access.reason);
  }

  return json({ deck: serializeDeckForApi(deck) });
};
