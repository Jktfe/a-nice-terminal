import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateAlternatives,
  findUnprocessedFeedbackEvents,
  processStageAlternatives,
  persistAlternatives
} from './stageAlternativeProcessor';
import type { DeckSlide } from './deckStore';
import { getIdentityDb } from './db';
import { listStageAlternatives } from './stageAlternativeStore';

describe('stageAlternativeProcessor', () => {
  const db = getIdentityDb();

  beforeEach(() => {
    db.prepare('DELETE FROM plan_events').run();
  });

  describe('generateAlternatives', () => {
    it('can replace the current slide even when no downstream slides exist', () => {
      const slides: DeckSlide[] = [
        { id: 's1', title: 'Only slide', content: 'Hello' }
      ];
      const alts = generateAlternatives(slides, 'this is wrong', 0);
      expect(alts).toHaveLength(1);
      expect(alts[0].slideIndex).toBe(0);
    });

    it('flags the current slide first on negative feedback', () => {
      const slides: DeckSlide[] = [
        { id: 's1', title: 'Intro', content: 'Welcome' },
        { id: 's2', title: 'Details', content: 'More info' },
        { id: 's3', title: 'Outro', content: 'Bye' }
      ];
      const alts = generateAlternatives(slides, "no, we don't do that", 0);
      expect(alts.length).toBeGreaterThan(0);
      expect(alts[0].slideIndex).toBe(0);
      expect(alts[0].proposedTitle).toMatch(/^⚠️/);
    });

    it('replaces the current slide when feedback asks for a concrete before-after example', () => {
      const slides: DeckSlide[] = [
        { id: 's1', title: 'Context', content: 'Set up' },
        { id: 's2', title: 'One model, every agent kind', content: 'All agents use one model.' },
        { id: 's3', title: 'Outcome', content: 'Cleaner joins.' }
      ];
      const alts = generateAlternatives(
        slides,
        'This slide overstates the claim — the join-flow simplification needs a concrete before/after example or it reads as hand-waving. Show the actual failure it removes.',
        1
      );
      expect(alts.length).toBeGreaterThan(0);
      expect(alts[0].slideIndex).toBe(1);
      expect(alts[0].proposedTitle).toContain('One model, every agent kind');
      expect(alts[0].proposedContent).toContain('Before / after');
    });

    it('returns nothing on positive feedback', () => {
      const slides: DeckSlide[] = [
        { id: 's1', title: 'Intro', content: 'Welcome' },
        { id: 's2', title: 'Details', content: 'More info' }
      ];
      const alts = generateAlternatives(slides, 'great work, love it', 0);
      expect(alts).toHaveLength(0);
    });

    it('caps at 3 downstream slides', () => {
      const slides: DeckSlide[] = Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`,
        title: `Slide ${i}`,
        content: `Content ${i}`
      }));
      const alts = generateAlternatives(slides, 'this is bad', 0);
      expect(alts.length).toBeLessThanOrEqual(3);
    });
  });

  describe('findUnprocessedFeedbackEvents', () => {
    it('returns empty when no feedback events exist', () => {
      const rows = findUnprocessedFeedbackEvents('nonexistent-deck');
      expect(rows).toHaveLength(0);
    });
  });

  describe('processStageAlternatives', () => {
    it('returns 0 when deck does not exist', () => {
      const count = processStageAlternatives('fake-deck-123');
      expect(count).toBe(0);
    });
  });

  describe('persistAlternatives', () => {
    it('keeps same-slide alternatives uniquely addressable inside one millisecond', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1234);
      try {
        const baseAlternative = {
          slideIndex: 0,
          originalTitle: 'Original',
          proposedTitle: 'First rewrite',
          proposedContent: 'First body',
          proposedSpeakerNotes: 'Say first',
          rationale: 'First agent-authored rewrite.'
        };

        persistAlternatives('deck-same-ms', 'feedback-a', [baseAlternative], '@agent-a');
        persistAlternatives(
          'deck-same-ms',
          'feedback-b',
          [{ ...baseAlternative, proposedTitle: 'Second rewrite', rationale: 'Second agent-authored rewrite.' }],
          '@agent-b'
        );

        const refs = listStageAlternatives('deck-same-ms').map((alternative) => alternative.ref);
        expect(new Set(refs).size).toBe(refs.length);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
