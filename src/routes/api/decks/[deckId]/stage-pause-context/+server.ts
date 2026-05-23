/**
 * POST /api/decks/:deckId/stage-pause-context — Stage v1 live-edit γ2.
 *
 * Persist + broadcast a pause-context event when TTS pauses on a slide.
 * The event arms agents to do alternative-generation (slice ε): version-B
 * proposals, ripple impact, claim retractions. The pause-context IS the
 * primitive; the human keeps choice on whether/when to apply alternatives.
 *
 * Schema (codex schema review 2026-05-22 21:55):
 *   - slide_id              (authoritative — must match slide at slide_index)
 *   - slide_index           (authoritative — server validates against deck)
 *   - narration_source      ('narration' | 'speakerNotes' | 'content')
 *   - paused_at_ms          (authoritative client clock; server clamps to now)
 *   - estimated_char_offset (DERIVED — labelled with `estimated_` prefix)
 *   - spoken_window         (best-effort excerpt; agents must not over-trust)
 *   - deck_id               (server-injected from URL param)
 *
 * Author (created_by) is server-resolved via requireChatRoomMutationAuth
 * — clients cannot stamp another handle.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { requireStagePresenterAuth } from '$lib/server/stagePresenterAuth';
import { appendPlanEvent } from '$lib/server/planModeStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';

type PausePayload = {
  planId?: unknown;
  slideId?: unknown;
  slideIndex?: unknown;
  narrationSource?: unknown;
  pausedAtMs?: unknown;
  estimatedCharOffset?: unknown;
  spokenWindow?: unknown;
};

const VALID_NARRATION_SOURCES = new Set(['narration', 'speakerNotes', 'content']);
const MAX_SPOKEN_WINDOW_CHARS = 500;

function readSlideIndex(raw: unknown, slideCount: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw error(400, 'slideIndex must be an integer.');
  }
  if (slideCount === 0) throw error(400, 'Deck has no slides.');
  if (raw < 0 || raw >= slideCount) throw error(400, 'slideIndex is outside the deck.');
  return raw;
}

export const POST: RequestHandler = async ({ params, request, url }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => null)) as PausePayload | null;
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

  const slideIndex = readSlideIndex(payload.slideIndex, deck.slides.length);
  const slide = deck.slides[slideIndex];
  if (!slide) throw error(400, 'slideIndex is outside the deck.');
  if (typeof payload.slideId === 'string' && payload.slideId.length > 0 && payload.slideId !== slide.id) {
    throw error(400, 'slideId does not match slideIndex.');
  }

  const narrationSource =
    typeof payload.narrationSource === 'string' && VALID_NARRATION_SOURCES.has(payload.narrationSource)
      ? (payload.narrationSource as 'narration' | 'speakerNotes' | 'content')
      : 'content';

  const tsMillis = Date.now();
  // Clamp client clock to server time — clients cannot post events in the
  // future or back-date them more than a minute (anti-spoofing).
  const clientPausedAtRaw =
    typeof payload.pausedAtMs === 'number' && Number.isFinite(payload.pausedAtMs)
      ? payload.pausedAtMs
      : tsMillis;
  const drift = Math.abs(tsMillis - clientPausedAtRaw);
  const pausedAtMs = drift > 60_000 ? tsMillis : clientPausedAtRaw;

  const estimatedCharOffset =
    typeof payload.estimatedCharOffset === 'number' && Number.isInteger(payload.estimatedCharOffset) && payload.estimatedCharOffset >= 0
      ? payload.estimatedCharOffset
      : 0;

  const spokenWindowRaw = typeof payload.spokenWindow === 'string' ? payload.spokenWindow : '';
  const spokenWindow = spokenWindowRaw.slice(0, MAX_SPOKEN_WINDOW_CHARS);

  const planId =
    typeof payload.planId === 'string' && payload.planId.trim().length > 0
      ? payload.planId.trim()
      : `stage-${deck.id}`;

  const label = `Pause: ${deck.title} · Slide ${slideIndex + 1} (${slide.title})`;
  const ref = `stage:${deck.id}:pause:${slide.id ?? slideIndex}:${pausedAtMs}`;

  const evidenceEntry = {
    kind: 'stage_pause_context' as const,
    ref,
    label,
    deck_id: deck.id,
    slide_id: slide.id,
    slide_index: slideIndex,
    narration_source: narrationSource,
    paused_at_ms: pausedAtMs,
    estimated_char_offset: estimatedCharOffset,
    spoken_window: spokenWindow
  };

  appendPlanEvent({
    id: `evt-stage-pause-${tsMillis}-${Math.random().toString(36).slice(2, 10)}`,
    plan_id: planId,
    kind: 'plan_decision',
    title: label,
    body: `Stage paused on slide ${slideIndex + 1} of deck ${deck.id} — awaiting feedback.`,
    order: slideIndex,
    author_handle: auth.handle,
    author_kind: auth.isAdminBearer ? 'system' : (auth.isDeckPassword ? 'human' : 'agent'),
    ts_millis: tsMillis,
    evidence: [evidenceEntry],
    provenance: { source: 'deck-viewer-pause', section: deck.id, author: auth.handle }
  });

  // Best-effort SSE fanout. Subscribers (slice ε agents) get the
  // pause-context event to act on. Do NOT post a chat message here —
  // pause events are presenter-side bookkeeping; only the human's
  // feedback (slice δ) should land in chat.
  try {
    broadcastToRoom(deck.roomId, {
      type: 'stage_pause_context',
      deckId: deck.id,
      roomId: deck.roomId,
      paused_at_ms: pausedAtMs,
      slide_id: slide.id,
      slide_index: slideIndex,
      narration_source: narrationSource,
      estimated_char_offset: estimatedCharOffset,
      spoken_window: spokenWindow,
      created_by: auth.handle
    });
  } catch {
    /* SSE fanout best-effort; event is persisted on the plan stream */
  }

  return json(
    {
      ok: true,
      pause_context: {
        ...evidenceEntry,
        created_by: auth.handle
      }
    },
    { status: 201 }
  );
};
