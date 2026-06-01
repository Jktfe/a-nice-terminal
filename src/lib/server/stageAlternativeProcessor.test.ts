import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateAlternatives,
  findUnprocessedFeedbackEvents,
  processStageAlternatives
} from './stageAlternativeProcessor';
import type { DeckSlide } from './deckStore';
import { getIdentityDb } from './db';
import { appendPlanEvent } from './planModeStore';

describe('stageAlternativeProcessor', () => {
  const db = getIdentityDb();

  beforeEach(() => {
    db.prepare('DELETE FROM plan_events').run();
  });

  describe('generateAlternatives', () => {
    it('returns empty when no downstream slides', () => {
      const slides: DeckSlide[] = [
        { id: 's1', title: 'Only slide', content: 'Hello' }
      ];
      const alts = generateAlternatives(slides, 'this is wrong', 0);
      expect(alts).toHaveLength(0);
    });

    it('flags downstream slides on negative feedback', () => {
      const slides: DeckSlide[] = [
        { id: 's1', title: 'Intro', content: 'Welcome' },
        { id: 's2', title: 'Details', content: 'More info' },
        { id: 's3', title: 'Outro', content: 'Bye' }
      ];
      const alts = generateAlternatives(slides, "no, we don't do that", 0);
      expect(alts.length).toBeGreaterThan(0);
      expect(alts[0].slideIndex).toBe(1);
      expect(alts[0].proposedTitle).toMatch(/^⚠️/);
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
});
