/**
 * POST /api/decks/:deckId/alternatives/decision
 *
 * Records the presenter choice for a Stage alternative without mutating the
 * source deck. The viewer composes the active presentation path from these
 * append-only decisions.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { requireStagePresenterAuth } from '$lib/server/stagePresenterAuth';
import {
  appendStageAlternativeDecision,
  isStageAlternativeDecisionAction,
  listStageAlternatives
} from '$lib/server/stageAlternativeStore';

type DecisionPayload = {
  alternativeRef?: unknown;
  action?: unknown;
};

export const POST: RequestHandler = async ({ params, request, url }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => null)) as DecisionPayload | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const auth = requireStagePresenterAuth({
    roomId: deck.roomId,
    deckAccessPassword: deck.accessPassword,
    request,
    url,
    rawBody: payload
  });

  if (typeof payload.alternativeRef !== 'string' || payload.alternativeRef.length === 0) {
    throw error(400, 'alternativeRef is required.');
  }
  if (!isStageAlternativeDecisionAction(payload.action)) {
    throw error(400, 'action must be replace-slide, append-after, append-appendix, park, or reject.');
  }

  const alternative = listStageAlternatives(deck.id).find((item) => item.ref === payload.alternativeRef);
  if (!alternative) throw error(404, 'Stage alternative not found.');

  const decision = appendStageAlternativeDecision({
    deckId: deck.id,
    alternativeRef: payload.alternativeRef,
    action: payload.action,
    decidedBy: auth.handle
  });

  return json({ ok: true, deckId: deck.id, decision }, { status: 201 });
};
