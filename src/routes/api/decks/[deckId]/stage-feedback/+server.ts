/**
 * POST /api/decks/:deckId/stage-feedback
 *
 * delta: feedback submission with pause-context attached.
 * The deck viewer POSTs here when the user hits Submit in the feedback panel.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { appendPlanEvent } from '$lib/server/planModeStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';

type StageFeedbackPayload = {
  slideIndex?: unknown;
  feedbackText?: unknown;
  pasteContext?: unknown;
  pauseContextRef?: unknown;
};

export const POST: RequestHandler = async ({ params, request }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => null)) as StageFeedbackPayload | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const auth = requireChatRoomMutationAuth(deck.roomId, request, payload);

  const slideIndex =
    typeof payload.slideIndex === 'number' && Number.isInteger(payload.slideIndex)
      ? payload.slideIndex
      : 0;
  const slide = deck.slides[slideIndex];
  if (!slide) throw error(400, 'slideIndex is outside the deck.');

  const feedbackText = typeof payload.feedbackText === 'string' ? payload.feedbackText : '';
  const pasteContext = typeof payload.pasteContext === 'string' ? payload.pasteContext : '';
  const pauseContextRef = typeof payload.pauseContextRef === 'string' ? payload.pauseContextRef : '';

  if (feedbackText.trim().length === 0) {
    throw error(400, 'feedbackText is required.');
  }

  const tsMillis = Date.now();
  const ref = pauseContextRef || `stage:${deck.id}:slide:${slide.id ?? slideIndex}:feedback`;
  const label = `Feedback on slide ${slideIndex + 1}: ${slide.title}`;

  appendPlanEvent({
    id: `evt-stage-feedback-${tsMillis}-${Math.random().toString(36).slice(2, 10)}`,
    plan_id: `stage-${deck.id}`,
    kind: 'plan_decision',
    title: `Stage feedback: ${deck.title} - ${label}`,
    body: feedbackText,
    order: slideIndex,
    author_handle: auth.handle,
    author_kind: auth.isAdminBearer ? 'system' : 'agent',
    ts_millis: tsMillis,
    evidence: [
      {
        kind: 'stage_feedback',
        ref,
        label,
        narration: pasteContext || (slide.speakerNotes ?? slide.narration ?? slide.content)
      }
    ],
    provenance: { source: 'deck-viewer', section: deck.id, author: auth.handle }
  });

  const roomMessage = postSystemMessage({
    roomId: deck.roomId,
    body: `Stage feedback: ${deck.title}\n\n${label}\n\n${feedbackText}`
  });
  try {
    fanoutMessageToRoomTerminals(deck.roomId, roomMessage);
  } catch { /* best-effort */ }
  try {
    broadcastToRoom(deck.roomId, { type: 'message_added', message: roomMessage });
  } catch { /* best-effort */ }

  return json({ ok: true, ref, slideIndex }, { status: 201 });
};
