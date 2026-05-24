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
import { getIdentityDb } from '$lib/server/db';
import { getDeck } from '$lib/server/deckStore';
import { resolveDeckAccess } from '$lib/server/deckAccessGate';
import { listTasksForPlan } from '$lib/server/taskStore';
import type { EvidenceRef } from '$lib/server/planModeStore';

type AlternativePayload = {
  originalTitle?: unknown;
  proposedTitle?: unknown;
  proposedContent?: unknown;
  proposedSpeakerNotes?: unknown;
};

type PlanEventRow = {
  id: string;
  title: string;
  body: string | null;
  order_index: number;
  ts_millis: number;
  evidence_json: string;
};

function parseSlideNumberFromSubject(subject: string): number | null {
  const match = subject.match(/\/ slide\s+(\d+)/i);
  if (!match) return null;
  const slideNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(slideNumber) && slideNumber > 0 ? slideNumber - 1 : null;
}

function parseEvidence(raw: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return [];
  }
}

function parseAlternativePayload(raw: string | undefined): AlternativePayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AlternativePayload) : {};
  } catch {
    return {};
  }
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

  const rows = getIdentityDb()
    .prepare(
      `SELECT id, title, body, order_index, ts_millis, evidence_json
       FROM plan_events
       WHERE plan_id = ? AND kind = 'plan_decision'
       ORDER BY ts_millis DESC`
    )
    .all(planId) as PlanEventRow[];

  const slideAlternatives = rows.flatMap((row) => {
    const evidence = parseEvidence(row.evidence_json);
    return evidence
      .filter((e) => e.kind === 'stage_alternative')
      .map((e) => {
        const payload = parseAlternativePayload(e.narration);
        return {
          kind: 'slide' as const,
          slideIndex: row.order_index,
          eventId: row.id,
          ref: e.ref,
          label: row.title,
          originalTitle: typeof payload.originalTitle === 'string' ? payload.originalTitle : null,
          proposedTitle: typeof payload.proposedTitle === 'string' ? payload.proposedTitle : row.title,
          proposedContent: typeof payload.proposedContent === 'string' ? payload.proposedContent : '',
          proposedSpeakerNotes:
            typeof payload.proposedSpeakerNotes === 'string' ? payload.proposedSpeakerNotes : '',
          rationale: row.body ?? '',
          createdAtMs: row.ts_millis
        };
      });
  });

  return json({
    deckId: deck.id,
    alternatives: [...proposalTracks, ...slideAlternatives].sort((a, b) => b.createdAtMs - a.createdAtMs)
  });
};
