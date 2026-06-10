/**
 * stageAlternativeProcessor — ε1 slice.
 *
 * When a stage_feedback plan_event lands, reads the paused slide +
 * downstream slides, generates 1-3 rewritten slide proposals, and writes
 * plan_decision events with stage_alternative evidence.
 *
 * Pure function + side-effect writer. No new tables. Reuses:
 *   - plan_events (reads stage_feedback, writes stage_alternative)
 *   - deckStore (reads deck.slides)
 *   - planModeStore (appendPlanEvent)
 *
 * Trigger: callee decides (route, cron, or SSE handler). This file is
 * the processor only.
 */

import { getIdentityDb } from './db';
import { getDeck, type DeckSlide } from './deckStore';
import { appendPlanEvent, type EvidenceRef } from './planModeStore';
import { appendStageAlternativeDecision } from './stageAlternativeStore';

export type StageAlternative = {
  slideIndex: number;
  originalTitle: string;
  proposedTitle: string;
  proposedContent: string;
  proposedSpeakerNotes: string;
  rationale: string;
};

export type StageAlternativeInput = {
  deckId: string;
  feedbackEventId: string;
  feedbackText: string;
  pauseContextRef: string;
  slideIndex: number;
  pasteContext?: string;
};

type FeedbackEventRow = {
  id: string;
  plan_id: string;
  body: string | null;
  evidence_json: string;
  ts_millis: number;
  order: number;
};

function parseFeedbackEvent(row: FeedbackEventRow): {
  feedbackText: string;
  slideIndex: number;
  pauseContextRef: string;
  pasteContext?: string;
} | null {
  let evidence: EvidenceRef[] = [];
  try {
    const parsed = JSON.parse(row.evidence_json);
    evidence = Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return null;
  }
  const fb = evidence.find((e) => e.kind === 'stage_feedback');
  if (!fb) return null;

  const pc = evidence.find((e) => e.kind === 'stage_pause_context');

  return {
    feedbackText: row.body || fb.narration || '',
    slideIndex: row.order,
    pauseContextRef: fb.ref,
    pasteContext: pc?.spoken_window ?? undefined
  };
}

/**
 * Find the N most recent stage_feedback events for a deck that have NOT
 * yet generated stage_alternative events. Simple heuristic: look for
 * feedback events whose ref does NOT appear in any later stage_alternative
 * evidence.
 */
export function findUnprocessedFeedbackEvents(deckId: string, limit = 5): FeedbackEventRow[] {
  const db = getIdentityDb();
  const planId = `stage-${deckId}`;

  // All feedback events for this stage
  const feedbackRows = db
    .prepare(
      `SELECT id, plan_id, body, evidence_json, ts_millis, "order_index" as "order"
       FROM plan_events
       WHERE plan_id = ? AND kind = 'plan_decision'
       ORDER BY ts_millis DESC`
    )
    .all(planId) as FeedbackEventRow[];

  // Filter to those with stage_feedback evidence
  const feedbackEvents = feedbackRows.filter((row) => {
    try {
      const ev = JSON.parse(row.evidence_json);
      return Array.isArray(ev) && (ev as EvidenceRef[]).some((e) => e.kind === 'stage_feedback');
    } catch {
      return false;
    }
  });

  if (feedbackEvents.length === 0) return [];

  // All alternative refs already generated
  const altRows = db
    .prepare(
      `SELECT evidence_json FROM plan_events
       WHERE plan_id = ? AND kind = 'plan_decision'
       ORDER BY ts_millis DESC`
    )
    .all(planId) as { evidence_json: string }[];

  const handledRefs = new Set<string>();
  for (const row of altRows) {
    try {
      const ev = JSON.parse(row.evidence_json) as EvidenceRef[];
      for (const e of ev) {
        if (e.kind === 'stage_alternative' && e.label?.startsWith('alt-for:')) {
          handledRefs.add(e.label.slice('alt-for:'.length));
        }
      }
    } catch { /* skip */ }
  }

  return feedbackEvents
    .filter((row) => {
      const parsed = parseFeedbackEvent(row);
      return parsed && !handledRefs.has(parsed.pauseContextRef);
    })
    .slice(0, limit);
}

/**
 * Naive but functional alternative generator.
 * Reads the paused slide first, then downstream slides, and rewrites
 * titles/content/speaker notes to incorporate actionable feedback.
 *
 * For ε1, this is rule-based. Future slices swap in an LLM call.
 */
export function generateAlternatives(
  slides: DeckSlide[],
  feedbackText: string,
  pausedSlideIndex: number
): StageAlternative[] {
  const targetSlides = slides
    .map((slide, slideIndex) => ({ slide, slideIndex }))
    .filter(({ slideIndex }) => slideIndex >= pausedSlideIndex)
    .slice(0, 3);
  if (targetSlides.length === 0) return [];

  const sentiment = analyseSentiment(feedbackText);
  const alternatives: StageAlternative[] = [];

  // Propose alternatives for the current slide first, then the next slides.
  for (const { slide, slideIndex: globalIndex } of targetSlides) {
    const alt = rewriteSlide(slide, sentiment, feedbackText);
    if (alt) {
      alternatives.push({
        slideIndex: globalIndex,
        originalTitle: slide.title,
        proposedTitle: alt.title,
        proposedContent: alt.content,
        proposedSpeakerNotes: alt.speakerNotes,
        rationale: `Slide ${globalIndex + 1} may need change because feedback says: "${sentiment.keyPhrase}".`
      });
    }
  }

  return alternatives;
}

type Sentiment = {
  negative: boolean;
  actionable: boolean;
  wantsBeforeAfter: boolean;
  keyPhrase: string;
};

function analyseSentiment(text: string): Sentiment {
  const lower = text.toLowerCase();
  const negative = /\b(no|not|wrong|bad|terrible|awful|don't|doesn't|shouldn't|mustn't|nope|incorrect|false)\b/.test(lower);
  const wantsBeforeAfter = /\b(before\s*\/\s*after|before\s+and\s+after|concrete|example|actual failure|failure it removes)\b/.test(lower);
  const actionable =
    negative ||
    wantsBeforeAfter ||
    /\b(overstates?|hand[-\s]?waving|missing|needs?|unclear|weak|thin|unsupported|show|explain|simplify|harden)\b/.test(lower);
  // Extract the first substantive clause as the key phrase
  const match = text.match(/(?:^|[.!?])\s*([^.,;!?]{10,120})/);
  const keyPhrase = match ? match[1].trim() : text.slice(0, 100);
  return { negative, actionable, wantsBeforeAfter, keyPhrase };
}

function rewriteSlide(
  slide: DeckSlide,
  sentiment: Sentiment,
  feedback: string
): { title: string; content: string; speakerNotes: string } | null {
  // ε1 rule set — if feedback is actionable, make an immediately visible
  // alternative. Agent-authored drafts can refine this scaffold afterward.
  if (!sentiment.actionable) return null;

  const title = sentiment.negative ? `⚠️ ${slide.title}` : `Alternative: ${slide.title}`;
  const content = sentiment.wantsBeforeAfter
    ? [
        slide.content,
        '',
        'Before / after proof to add:',
        '- Before: describe the concrete failure mode this slide removes.',
        '- After: describe the simplified path after the change.',
        `- Evidence needed: ${sentiment.keyPhrase}.`
      ].filter(Boolean).join('\n')
    : [
        slide.content,
        '',
        `Feedback to address: ${sentiment.keyPhrase}.`
      ].filter(Boolean).join('\n');
  const notes = [
    slide.speakerNotes || slide.narration || '',
    `\n[ALTERNATIVE TRIGGERED — feedback: "${sentiment.keyPhrase}"]`
  ].filter(Boolean).join('\n');

  return { title, content, speakerNotes: notes };
}

/**
 * Persist generated alternatives as plan_decision events with
 * stage_alternative evidence. Returns the event IDs written.
 */
export function persistAlternatives(
  deckId: string,
  pauseContextRef: string,
  alternatives: StageAlternative[],
  handle: string
): string[] {
  const planId = `stage-${deckId}`;
  const tsMillis = Date.now();
  const written: string[] = [];

  for (const alt of alternatives) {
    const nonce = Math.random().toString(36).slice(2, 8);
    const eventId = `evt-alt-${tsMillis}-${nonce}`;
    const alternativeRef = `alt:${deckId}:slide:${alt.slideIndex}:${tsMillis}:${nonce}`;

    appendPlanEvent({
      id: eventId,
      plan_id: planId,
      kind: 'plan_decision',
      title: `Alternative for slide ${alt.slideIndex + 1}: ${alt.proposedTitle}`,
      body: alt.rationale,
      order: alt.slideIndex,
      author_handle: handle,
      author_kind: 'agent',
      ts_millis: tsMillis,
      evidence: [
        {
          kind: 'stage_alternative',
          ref: alternativeRef,
          label: `alt-for:${pauseContextRef}`,
          narration: JSON.stringify({
            originalTitle: alt.originalTitle,
            proposedTitle: alt.proposedTitle,
            proposedContent: alt.proposedContent,
            proposedSpeakerNotes: alt.proposedSpeakerNotes
          })
        }
      ],
      provenance: { source: 'stage-alternative-processor', section: deckId, author: handle }
    });

    appendStageAlternativeDecision({
      deckId,
      alternativeRef,
      action: 'replace-slide',
      decidedBy: handle
    });

    written.push(eventId);
  }

  return written;
}

/**
 * End-to-end processor entrypoint.
 * Call with a deckId. Finds unprocessed feedback, generates alternatives,
 * persists them. Returns count of alternatives written.
 */
export function processStageAlternatives(deckId: string, handle = '@speedykimi'): number {
  const deck = getDeck(deckId);
  if (!deck) return 0;

  const feedbackEvents = findUnprocessedFeedbackEvents(deckId);
  if (feedbackEvents.length === 0) return 0;

  let totalWritten = 0;
  for (const row of feedbackEvents) {
    const parsed = parseFeedbackEvent(row);
    if (!parsed) continue;

    const alternatives = generateAlternatives(deck.slides, parsed.feedbackText, parsed.slideIndex);
    if (alternatives.length > 0) {
      persistAlternatives(deckId, parsed.pauseContextRef, alternatives, handle);
      totalWritten += alternatives.length;
    }
  }

  return totalWritten;
}
