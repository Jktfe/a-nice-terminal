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
import { listTasksForPlan } from '$lib/server/taskStore';
import { listStageAlternatives } from '$lib/server/stageAlternativeStore';

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
