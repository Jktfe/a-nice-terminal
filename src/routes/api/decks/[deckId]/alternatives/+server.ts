/**
 * GET /api/decks/:deckId/alternatives
 *
 * Read model for ANT Stage alternatives. It exposes the two alternative
 * surfaces Stage already creates:
 * - proposal tracks for the slide that received feedback;
 * - generated downstream slide rewrites from stage_alternative evidence.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDeck } from '$lib/server/deckStore';
import { resolveDeckAccess } from '$lib/server/deckAccessGate';
import { requireStagePresenterAuth } from '$lib/server/stagePresenterAuth';
import { listTasksForPlan } from '$lib/server/taskStore';
import { listStageAlternatives } from '$lib/server/stageAlternativeStore';
import { persistAlternatives, type StageAlternative } from '$lib/server/stageAlternativeProcessor';

function parseSlideNumberFromSubject(subject: string): number | null {
  const match = subject.match(/\/ slide\s+(\d+)/i);
  if (!match) return null;
  const slideNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(slideNumber) && slideNumber > 0 ? slideNumber - 1 : null;
}

export const GET: RequestHandler = ({ params, request, url }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const access = resolveDeckAccess({
    deckRoomId: deck.roomId,
    deckAccessPassword: deck.accessPassword,
    request,
    url
  });
  if (!access.allowed) throw error(403, access.reason);

  const planId = `stage-${deck.id}`;
  const proposalTracks = listTasksForPlan(planId)
    .flatMap((task) => {
      const slideIndex = parseSlideNumberFromSubject(task.subject);
      if (slideIndex === null) return [];
      return task.evidence
        .filter((e) => e.kind === 'proposal')
        .map((e) => ({
          kind: 'proposal' as const,
          slideIndex,
          taskId: task.id,
          ref: e.ref,
          label: e.label ?? task.subject,
          lens: e.label?.split(':')[0] ?? null,
          summary: task.description,
          createdAtMs: task.createdAtMs
        }));
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  const slideAlternatives = listStageAlternatives(deck.id);

  return json({
    deckId: deck.id,
    alternatives: [...proposalTracks, ...slideAlternatives].sort((a, b) => b.createdAtMs - a.createdAtMs)
  });
};

/**
 * POST /api/decks/:deckId/alternatives
 *
 * Agent-AUTHORED alternative (JWPK msg_9y4t51xbky 2026-06-10 "deliver the magic").
 * Before this, alternatives could ONLY be produced by the server heuristic
 * (process-alternatives → generateAlternatives), so an agent reading live stage
 * feedback had no way to push its OWN drafted replacement slide onto the live
 * deck — it fell back to creating a whole new deck version. This lets an agent
 * (or @admin via the alt-track) author a replacement slide directly; it's
 * persisted as a `stage_alternative` + `replace-slide` decision (reusing
 * persistAlternatives), so the deck's existing 3s livePoll renders the
 * alternative track in real time. Reorder/hide remain via updateDeck (already
 * live). Presenter-auth gated, same as stage-feedback.
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
  const deck = getDeck(params.deckId);
  if (!deck) throw error(404, 'Deck not found.');

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') throw error(400, 'JSON body required.');

  const auth = requireStagePresenterAuth({
    roomId: deck.roomId,
    deckAccessPassword: deck.accessPassword,
    request,
    url,
    rawBody: payload
  });

  // Slide index: accept 0-based `slideIndex` or 1-based `slideNumber`.
  const slideIndex =
    typeof payload.slideIndex === 'number' && Number.isInteger(payload.slideIndex)
      ? payload.slideIndex
      : typeof payload.slideNumber === 'number' && Number.isInteger(payload.slideNumber)
        ? payload.slideNumber - 1
        : null;
  if (slideIndex === null || slideIndex < 0 || slideIndex >= deck.slides.length) {
    throw error(400, 'slideIndex (0-based) or slideNumber (1-based) within the deck is required.');
  }

  const proposedTitle = typeof payload.proposedTitle === 'string' ? payload.proposedTitle.trim() : '';
  const proposedContent = typeof payload.proposedContent === 'string' ? payload.proposedContent : '';
  if (proposedTitle.length === 0 || proposedContent.length === 0) {
    throw error(400, 'proposedTitle and proposedContent are required.');
  }

  const alternative: StageAlternative = {
    slideIndex,
    originalTitle: deck.slides[slideIndex]?.title ?? '',
    proposedTitle,
    proposedContent,
    proposedSpeakerNotes:
      typeof payload.proposedSpeakerNotes === 'string' ? payload.proposedSpeakerNotes : '',
    rationale:
      typeof payload.rationale === 'string' && payload.rationale.trim().length > 0
        ? payload.rationale.trim()
        : `Alternative for slide ${slideIndex + 1} authored by ${auth.handle}.`
  };

  const pauseContextRef =
    typeof payload.pauseContextRef === 'string' && payload.pauseContextRef.length > 0
      ? payload.pauseContextRef
      : `authored:${deck.id}:slide:${slideIndex}`;

  const written = persistAlternatives(deck.id, pauseContextRef, [alternative], auth.handle);

  return json({ ok: true, slideIndex, written, authoredBy: auth.handle }, { status: 201 });
};
