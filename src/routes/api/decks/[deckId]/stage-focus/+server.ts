/**
 * POST /api/decks/:deckId/stage-focus
 *
 * Stage v1 M-Viewer: publish the currently visible slide from the existing
 * shareable deck viewer into the existing Stage evidence stream. This is a
 * tiny write-side companion to stageStore.ts, not a new Stage persistence
 * layer.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { appendPlanEvent } from '$lib/server/planModeStore';
import { getCurrentFocus } from '$lib/server/stageStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';

type StageFocusPayload = {
  planId?: unknown;
  slideId?: unknown;
  slideIndex?: unknown;
  slideTitle?: unknown;
};

export const GET: RequestHandler = async ({ params, request }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');
  const room = findChatRoomById(deck.roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);
  return json({ focus: getCurrentFocus(deck.id) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => null)) as StageFocusPayload | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const auth = requireChatRoomMutationAuth(deck.roomId, request, payload);
  const slideIndex = readSlideIndex(payload.slideIndex, deck.slides.length);
  const slide = deck.slides[slideIndex];
  if (!slide) throw error(400, 'slideIndex is outside the deck.');
  if (typeof payload.slideId === 'string' && payload.slideId.length > 0 && payload.slideId !== slide.id) {
    throw error(400, 'slideId does not match slideIndex.');
  }

  const planId =
    typeof payload.planId === 'string' && payload.planId.trim().length > 0
      ? payload.planId.trim()
      : `stage-${deck.id}`;
  const label = `Slide ${slideIndex + 1}: ${slide.title}`;
  const ref = `stage:${deck.id}:slide:${slide.id}`;
  const tsMillis = Date.now();

  appendPlanEvent({
    id: `evt-stage-focus-${tsMillis}-${Math.random().toString(36).slice(2, 10)}`,
    plan_id: planId,
    kind: 'plan_decision',
    title: `Stage focus: ${deck.title} - ${label}`,
    body: `Current stage focus for deck ${deck.id}.`,
    order: slideIndex,
    author_handle: auth.handle,
    author_kind: auth.isAdminBearer ? 'system' : 'agent',
    ts_millis: tsMillis,
    evidence: [
      {
        kind: 'stage_focus',
        ref,
        label,
        narration: slide.content
      }
    ],
    provenance: { source: 'deck-viewer', section: deck.id, author: auth.handle }
  });

  const focus = getCurrentFocus(deck.id);
  const roomMessage = postSystemMessage({
    roomId: deck.roomId,
    body: `Stage focus: ${deck.title}\n\n${label}`
  });
  try {
    fanoutMessageToRoomTerminals(deck.roomId, roomMessage);
  } catch {
    /* terminal fanout is best-effort; focus evidence is already persisted */
  }
  try {
    broadcastToRoom(deck.roomId, { type: 'message_added', message: roomMessage });
  } catch {
    /* browser broadcast is best-effort; focus evidence is already persisted */
  }

  return json({ focus, message: roomMessage }, { status: 201 });
};

function readSlideIndex(raw: unknown, slideCount: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw error(400, 'slideIndex must be an integer.');
  }
  if (slideCount === 0) throw error(400, 'Deck has no slides.');
  if (raw < 0 || raw >= slideCount) throw error(400, 'slideIndex is outside the deck.');
  return raw;
}
