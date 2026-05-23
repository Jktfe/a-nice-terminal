/**
 * POST /api/decks/:deckId/process-alternatives — ε2 trigger.
 *
 * Idempotent endpoint that runs the stageAlternativeProcessor for a
 * given deck and returns the generated alternatives.
 *
 * Auth: requires chat-room mutation auth (same as stage-feedback).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { processStageAlternatives } from '$lib/server/stageAlternativeProcessor';

export const POST: RequestHandler = async ({ params, request }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = requireChatRoomMutationAuth(deck.roomId, request, payload);

  const writtenCount = processStageAlternatives(deck.id, auth.handle);

  return json({ ok: true, deckId: deck.id, alternativesGenerated: writtenCount }, { status: 200 });
};
