import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { createDeck, resetDeckStoreForTests } from './deckStore';
import {
  appendStageAlternativeDecision,
  composeStageSlides,
  listStageAlternatives,
  resetStageAlternativeDecisionsForTests
} from './stageAlternativeStore';
import { appendPlanEvent, resetPlanModeStoreForTests } from './planModeStore';

beforeEach(() => {
  resetChatRoomStoreForTests();
  resetDeckStoreForTests();
  resetPlanModeStoreForTests();
});

function makeDeckWithAlternative() {
  const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
  const deck = createDeck({
    roomId: room.id,
    title: 'Stage Deck',
    slides: [
      { id: 's1', title: 'Original 1', content: 'A', speakerNotes: 'Say A' },
      { id: 's2', title: 'Original 2', content: 'B', speakerNotes: 'Say B' }
    ]
  });
  appendPlanEvent({
    id: 'evt-alt-1',
    plan_id: `stage-${deck.id}`,
    kind: 'plan_decision',
    title: 'Alternative for slide 1: Better first slide',
    body: 'Answers feedback about slide 1.',
    order: 0,
    author_handle: '@agent',
    author_kind: 'agent',
    ts_millis: 1000,
    evidence: [{
      kind: 'stage_alternative',
      ref: `alt:${deck.id}:slide:0:1000`,
      label: 'alt-for:feedback-ref-1',
      narration: JSON.stringify({
        originalTitle: 'Original 1',
        proposedTitle: 'Better first slide',
        proposedContent: 'A2',
        proposedSpeakerNotes: 'Say A2'
      })
    }]
  });
  return deck;
}

describe('stageAlternativeStore', () => {
  it('lists alternatives with feedback provenance and no decision by default', () => {
    const deck = makeDeckWithAlternative();

    const alternatives = listStageAlternatives(deck.id);

    expect(alternatives).toHaveLength(1);
    expect(alternatives[0]).toMatchObject({
      kind: 'slide',
      slideIndex: 0,
      ref: `alt:${deck.id}:slide:0:1000`,
      feedbackRef: 'feedback-ref-1',
      proposedTitle: 'Better first slide',
      decision: null
    });
  });

  it('records the latest presenter decision for an alternative', () => {
    const deck = makeDeckWithAlternative();
    const alternative = listStageAlternatives(deck.id)[0];

    appendStageAlternativeDecision({
      deckId: deck.id,
      alternativeRef: alternative.ref,
      action: 'park',
      decidedBy: '@you',
      nowMs: 2000
    });
    appendStageAlternativeDecision({
      deckId: deck.id,
      alternativeRef: alternative.ref,
      action: 'replace-slide',
      decidedBy: '@you',
      nowMs: 3000
    });

    expect(listStageAlternatives(deck.id)[0].decision).toMatchObject({
      action: 'replace-slide',
      decidedBy: '@you',
      decidedAtMs: 3000
    });
  });

  it('composes the presenter path from accepted replacements and appendix slides', () => {
    const deck = makeDeckWithAlternative();
    const replacement = listStageAlternatives(deck.id)[0];
    appendPlanEvent({
      id: 'evt-alt-2',
      plan_id: `stage-${deck.id}`,
      kind: 'plan_decision',
      title: 'Alternative for slide 2: Appendix context',
      body: 'Append this as supporting material.',
      order: 1,
      author_handle: '@agent',
      author_kind: 'agent',
      ts_millis: 1100,
      evidence: [{
        kind: 'stage_alternative',
        ref: `alt:${deck.id}:slide:1:1100`,
        label: 'alt-for:feedback-ref-2',
        narration: JSON.stringify({
          originalTitle: 'Original 2',
          proposedTitle: 'Appendix context',
          proposedContent: 'Appendix body',
          proposedSpeakerNotes: 'Say appendix'
        })
      }]
    });
    const appendix = listStageAlternatives(deck.id).find((alt) => alt.ref.endsWith(':1100'))!;

    appendStageAlternativeDecision({
      deckId: deck.id,
      alternativeRef: replacement.ref,
      action: 'replace-slide',
      decidedBy: '@you',
      nowMs: 2000
    });
    appendStageAlternativeDecision({
      deckId: deck.id,
      alternativeRef: appendix.ref,
      action: 'append-appendix',
      decidedBy: '@you',
      nowMs: 2100
    });

    const composed = composeStageSlides(deck, listStageAlternatives(deck.id));

    expect(composed.map((slide) => slide.title)).toEqual([
      'Better first slide',
      'Original 2',
      'Appendix context'
    ]);
    expect(composed[0]).toMatchObject({
      id: 'alt-slide-0',
      sourceAlternativeRef: replacement.ref,
      sourceSlideIndex: 0
    });
    expect(composed[2]).toMatchObject({
      id: 'appendix-alt-slide-1',
      sourceAlternativeRef: appendix.ref,
      sourceSlideIndex: 1
    });
  });
});
