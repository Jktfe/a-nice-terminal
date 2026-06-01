import { getIdentityDb } from './db';
import type { DeckSlide, RoomDeck } from './deckStore';
import { appendPlanEvent, type EvidenceRef } from './planModeStore';

export type StageAlternativeDecisionAction =
  | 'replace-slide'
  | 'append-after'
  | 'append-appendix'
  | 'park'
  | 'reject';

export type StageAlternativeDecision = {
  alternativeRef: string;
  action: StageAlternativeDecisionAction;
  decidedBy: string;
  decidedAtMs: number;
};

export type StageSlideAlternative = {
  kind: 'slide';
  slideIndex: number;
  eventId: string;
  ref: string;
  feedbackRef: string | null;
  label: string;
  originalTitle: string | null;
  proposedTitle: string;
  proposedContent: string;
  proposedSpeakerNotes: string;
  rationale: string;
  createdAtMs: number;
  decision: StageAlternativeDecision | null;
};

export type StageComposedSlide = DeckSlide & {
  source: 'original' | 'alternative';
  sourceSlideIndex: number;
  sourceAlternativeRef?: string;
};

type PlanEventRow = {
  id: string;
  title: string;
  body: string | null;
  order_index: number;
  ts_millis: number;
  author_handle: string;
  evidence_json: string;
};

type AlternativePayload = {
  originalTitle?: unknown;
  proposedTitle?: unknown;
  proposedContent?: unknown;
  proposedSpeakerNotes?: unknown;
};

type DecisionPayload = {
  action?: unknown;
  decidedBy?: unknown;
  decidedAtMs?: unknown;
};

function parseEvidence(raw: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return [];
  }
}

function parseObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function feedbackRefFromLabel(label: string | undefined): string | null {
  if (!label?.startsWith('alt-for:')) return null;
  const ref = label.slice('alt-for:'.length).trim();
  return ref.length > 0 ? ref : null;
}

export function isStageAlternativeDecisionAction(value: unknown): value is StageAlternativeDecisionAction {
  return (
    value === 'replace-slide' ||
    value === 'append-after' ||
    value === 'append-appendix' ||
    value === 'park' ||
    value === 'reject'
  );
}

function planIdFor(deckId: string): string {
  return `stage-${deckId}`;
}

function listDecisionEvents(deckId: string): StageAlternativeDecision[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, title, body, order_index, ts_millis, author_handle, evidence_json
       FROM plan_events
       WHERE plan_id = ? AND kind = 'plan_decision'
       ORDER BY ts_millis ASC`
    )
    .all(planIdFor(deckId)) as PlanEventRow[];

  const decisions: StageAlternativeDecision[] = [];
  for (const row of rows) {
    for (const evidence of parseEvidence(row.evidence_json)) {
      if (evidence.kind !== 'stage_alternative_decision') continue;
      const payload = parseObject(evidence.narration) as DecisionPayload;
      const action = payload.action;
      if (!isStageAlternativeDecisionAction(action)) continue;
      decisions.push({
        alternativeRef: evidence.ref,
        action,
        decidedBy: typeof payload.decidedBy === 'string' ? payload.decidedBy : row.author_handle,
        decidedAtMs: typeof payload.decidedAtMs === 'number' ? payload.decidedAtMs : row.ts_millis
      });
    }
  }
  return decisions;
}

export function listStageAlternativeDecisions(deckId: string): Map<string, StageAlternativeDecision> {
  const latest = new Map<string, StageAlternativeDecision>();
  for (const decision of listDecisionEvents(deckId)) {
    const incumbent = latest.get(decision.alternativeRef);
    if (!incumbent || decision.decidedAtMs >= incumbent.decidedAtMs) {
      latest.set(decision.alternativeRef, decision);
    }
  }
  return latest;
}

export function listStageAlternatives(deckId: string): StageSlideAlternative[] {
  const latestDecisionByRef = listStageAlternativeDecisions(deckId);
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, title, body, order_index, ts_millis, author_handle, evidence_json
       FROM plan_events
       WHERE plan_id = ? AND kind = 'plan_decision'
       ORDER BY ts_millis DESC`
    )
    .all(planIdFor(deckId)) as PlanEventRow[];

  return rows.flatMap((row) => {
    const evidence = parseEvidence(row.evidence_json);
    return evidence
      .filter((entry) => entry.kind === 'stage_alternative')
      .map((entry): StageSlideAlternative => {
        const payload = parseObject(entry.narration) as AlternativePayload;
        const proposedTitle =
          typeof payload.proposedTitle === 'string' ? payload.proposedTitle : row.title;
        return {
          kind: 'slide',
          slideIndex: row.order_index,
          eventId: row.id,
          ref: entry.ref,
          feedbackRef: feedbackRefFromLabel(entry.label),
          label: row.title,
          originalTitle: typeof payload.originalTitle === 'string' ? payload.originalTitle : null,
          proposedTitle,
          proposedContent: typeof payload.proposedContent === 'string' ? payload.proposedContent : '',
          proposedSpeakerNotes:
            typeof payload.proposedSpeakerNotes === 'string' ? payload.proposedSpeakerNotes : '',
          rationale: row.body ?? '',
          createdAtMs: row.ts_millis,
          decision: latestDecisionByRef.get(entry.ref) ?? null
        };
      });
  });
}

export function appendStageAlternativeDecision(input: {
  deckId: string;
  alternativeRef: string;
  action: StageAlternativeDecisionAction;
  decidedBy: string;
  nowMs?: number;
}): StageAlternativeDecision {
  const nowMs = input.nowMs ?? Date.now();
  const decision: StageAlternativeDecision = {
    alternativeRef: input.alternativeRef,
    action: input.action,
    decidedBy: input.decidedBy,
    decidedAtMs: nowMs
  };
  appendPlanEvent({
    id: `evt-stage-alt-decision-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
    plan_id: planIdFor(input.deckId),
    kind: 'plan_decision',
    title: `Stage alternative decision: ${input.action}`,
    body: `Presenter chose ${input.action} for ${input.alternativeRef}.`,
    order: 0,
    author_handle: input.decidedBy,
    author_kind: input.decidedBy === '@you' ? 'human' : 'agent',
    ts_millis: nowMs,
    evidence: [{
      kind: 'stage_alternative_decision',
      ref: input.alternativeRef,
      label: input.action,
      narration: JSON.stringify(decision)
    }],
    provenance: { source: 'stage-alternatives', section: input.deckId, author: input.decidedBy }
  });
  return decision;
}

function alternativeToSlide(
  alternative: StageSlideAlternative,
  idPrefix: string
): StageComposedSlide {
  return {
    id: `${idPrefix}-${alternative.slideIndex}`,
    title: alternative.proposedTitle,
    content: alternative.proposedContent,
    speakerNotes: alternative.proposedSpeakerNotes,
    source: 'alternative',
    sourceSlideIndex: alternative.slideIndex,
    sourceAlternativeRef: alternative.ref
  };
}

export function composeStageSlides(
  deck: RoomDeck,
  alternatives: StageSlideAlternative[]
): StageComposedSlide[] {
  const replacements = new Map<number, StageSlideAlternative>();
  const appendAfter = new Map<number, StageSlideAlternative[]>();
  const appendix: StageSlideAlternative[] = [];

  for (const alternative of alternatives) {
    const action = alternative.decision?.action;
    if (!action || action === 'park' || action === 'reject') continue;
    if (action === 'replace-slide') {
      const incumbent = replacements.get(alternative.slideIndex);
      if (!incumbent || (alternative.decision?.decidedAtMs ?? 0) >= (incumbent.decision?.decidedAtMs ?? 0)) {
        replacements.set(alternative.slideIndex, alternative);
      }
      continue;
    }
    if (action === 'append-after') {
      const list = appendAfter.get(alternative.slideIndex) ?? [];
      list.push(alternative);
      list.sort((a, b) => (a.decision?.decidedAtMs ?? 0) - (b.decision?.decidedAtMs ?? 0));
      appendAfter.set(alternative.slideIndex, list);
      continue;
    }
    if (action === 'append-appendix') {
      appendix.push(alternative);
    }
  }

  appendix.sort((a, b) => (a.decision?.decidedAtMs ?? 0) - (b.decision?.decidedAtMs ?? 0));

  const composed: StageComposedSlide[] = [];
  for (let index = 0; index < deck.slides.length; index += 1) {
    const replacement = replacements.get(index);
    if (replacement) {
      composed.push(alternativeToSlide(replacement, 'alt-slide'));
    } else {
      composed.push({ ...deck.slides[index], source: 'original', sourceSlideIndex: index });
    }
    for (const alternative of appendAfter.get(index) ?? []) {
      composed.push(alternativeToSlide(alternative, 'after-alt-slide'));
    }
  }
  for (const alternative of appendix) {
    composed.push(alternativeToSlide(alternative, 'appendix-alt-slide'));
  }
  return composed;
}

export function resetStageAlternativeDecisionsForTests(): void {
  getIdentityDb()
    .prepare(
      `DELETE FROM plan_events
       WHERE evidence_json LIKE '%"stage_alternative_decision"%'`
    )
    .run();
}
