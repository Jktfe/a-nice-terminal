import { describe, it, expect } from 'vitest';
import {
  computePromotionScore,
  selectPromotionCandidates,
  computeBacklinkCounts,
  type PromotableEntry,
  type LinkedEntry
} from './memoryPromotion';

const NOW = 2_000_000_000_000; // fixed clock

function entry(over: Partial<PromotableEntry> = {}): PromotableEntry {
  return {
    id: 'e',
    type: 'reference',
    tags: [],
    backlinkCount: 0,
    crossProjectRefs: 0,
    storedAtMs: NOW, // fresh by default
    ...over
  };
}

describe('computePromotionScore — wayland formula, ANT-tuned', () => {
  it('+30 for high-signal types, 0 for low-signal', () => {
    // fresh (+15 recency) + type
    expect(computePromotionScore(entry({ type: 'decision' }), NOW)).toBe(45);
    expect(computePromotionScore(entry({ type: 'pattern' }), NOW)).toBe(45);
    expect(computePromotionScore(entry({ type: 'feedback' }), NOW)).toBe(45);
    expect(computePromotionScore(entry({ type: 'reference' }), NOW)).toBe(15); // recency only
  });

  it('+10 per cross-project ref, +5 per backlink', () => {
    expect(computePromotionScore(entry({ crossProjectRefs: 3 }), NOW)).toBe(15 + 30);
    expect(computePromotionScore(entry({ backlinkCount: 4 }), NOW)).toBe(15 + 20);
  });

  it('+20 for a promoted tag (case-insensitive)', () => {
    expect(computePromotionScore(entry({ tags: ['Architecture'] }), NOW)).toBe(15 + 20);
    expect(computePromotionScore(entry({ tags: ['misc'] }), NOW)).toBe(15);
  });

  it('recency: full <24h, decays to 0 at 30d', () => {
    expect(computePromotionScore(entry({ storedAtMs: NOW }), NOW)).toBe(15); // fresh
    const d15 = NOW - 15 * 24 * 60 * 60 * 1000; // ~halfway → ~8
    const s = computePromotionScore(entry({ storedAtMs: d15 }), NOW);
    expect(s).toBeGreaterThan(5);
    expect(s).toBeLessThan(12);
    const d40 = NOW - 40 * 24 * 60 * 60 * 1000; // past 30d → 0
    expect(computePromotionScore(entry({ storedAtMs: d40 }), NOW)).toBe(0);
  });

  it('caps at 100', () => {
    const maxed = entry({
      type: 'decision',
      crossProjectRefs: 20,
      backlinkCount: 20,
      tags: ['global'],
      storedAtMs: NOW
    });
    expect(computePromotionScore(maxed, NOW)).toBe(100);
  });
});

describe('selectPromotionCandidates', () => {
  it('returns entries ≥ threshold, highest score first', () => {
    const entries = [
      entry({ id: 'low', type: 'reference', storedAtMs: NOW - 40 * 86400000 }), // 0
      entry({ id: 'mid', type: 'decision', backlinkCount: 2, tags: ['global'] }), // 30+10+20+15=75
      entry({ id: 'high', type: 'decision', crossProjectRefs: 5, tags: ['global'] }) // 30+50+20+15→100
    ];
    expect(selectPromotionCandidates(entries, NOW, 90).map((c) => c.id)).toEqual(['high']);
    const top2 = selectPromotionCandidates(entries, NOW, 70);
    expect(top2.map((c) => c.id)).toEqual(['high', 'mid']); // sorted desc
  });

  it('default threshold is conservative (90)', () => {
    const e = entry({ id: 'x', type: 'decision', tags: ['global'], backlinkCount: 1 }); // 30+20+5+15=70
    expect(selectPromotionCandidates([e], NOW)).toHaveLength(0); // 70 < 90 default
  });
});

describe('computeBacklinkCounts — [[links]] → referencedBy', () => {
  it('counts inbound links, ignores self-links and unknown targets', () => {
    const entries: LinkedEntry[] = [
      { id: 'a', links: ['b', 'b', 'c', 'ghost'] }, // dup b counts once; ghost unknown
      { id: 'b', links: ['b'] }, // self-link ignored
      { id: 'c', links: ['a'] }
    ];
    const counts = computeBacklinkCounts(entries);
    expect(counts.get('a')).toBe(1); // from c
    expect(counts.get('b')).toBe(1); // from a (dedup), not self
    expect(counts.get('c')).toBe(1); // from a
  });

  it('zero-fills entries with no backlinks', () => {
    const counts = computeBacklinkCounts([{ id: 'lonely', links: [] }]);
    expect(counts.get('lonely')).toBe(0);
  });
});
