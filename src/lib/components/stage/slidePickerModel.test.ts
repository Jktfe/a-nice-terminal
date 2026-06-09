import { describe, it, expect } from 'vitest';
import {
  reorderSlides,
  setHidden,
  deleteSlide,
  setLiveVariant,
  setViewing,
  liveVariant,
  type PickerSlide,
  type DeckVersionRef
} from './slidePickerModel';

function slide(position: number, variants: Array<[string, boolean]>, hidden = false): PickerSlide {
  return {
    position,
    title: `Slide ${position}`,
    hidden,
    variants: variants.map(([slideId, isLive], i) => ({ slideId, label: `v${i + 1}`, isLive }))
  };
}

const deck = (): PickerSlide[] => [
  slide(1, [['s1', true]]),
  slide(2, [['s2a', true], ['s2b', false]]),
  slide(3, [['s3', true]])
];

describe('reorderSlides', () => {
  it('moves a slide and renumbers positions 1..n', () => {
    const out = reorderSlides(deck(), 0, 2); // slide 1 → end
    expect(out.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(liveVariant(out[2])?.slideId).toBe('s1');
    expect(liveVariant(out[0])?.slideId).toBe('s2a');
  });
  it('is a no-op (but renumbers) on out-of-range or equal indices', () => {
    expect(reorderSlides(deck(), 0, 0).map((s) => liveVariant(s)?.slideId)).toEqual(['s1', 's2a', 's3']);
    expect(reorderSlides(deck(), -1, 2).map((s) => liveVariant(s)?.slideId)).toEqual(['s1', 's2a', 's3']);
    expect(reorderSlides(deck(), 0, 99).map((s) => liveVariant(s)?.slideId)).toEqual(['s1', 's2a', 's3']);
  });
});

describe('setHidden', () => {
  it('hides and shows a position; others untouched', () => {
    const hidden = setHidden(deck(), 2, true);
    expect(hidden.find((s) => s.position === 2)?.hidden).toBe(true);
    expect(hidden.find((s) => s.position === 1)?.hidden).toBe(false);
    expect(setHidden(hidden, 2, false).find((s) => s.position === 2)?.hidden).toBe(false);
  });
  it('unknown position → unchanged', () => {
    expect(setHidden(deck(), 99, true).some((s) => s.hidden)).toBe(false);
  });
});

describe('deleteSlide', () => {
  it('removes a position and renumbers', () => {
    const out = deleteSlide(deck(), 2);
    expect(out.map((s) => s.position)).toEqual([1, 2]);
    expect(out.map((s) => liveVariant(s)?.slideId)).toEqual(['s1', 's3']);
  });
  it('refuses to delete the last remaining slide', () => {
    const one = [slide(1, [['s1', true]])];
    expect(deleteSlide(one, 1)).toHaveLength(1);
  });
});

describe('setLiveVariant — exactly one live per position', () => {
  it('promotes a stored variant and demotes its siblings', () => {
    const out = setLiveVariant(deck(), 2, 's2b');
    const pos2 = out.find((s) => s.position === 2)!;
    expect(pos2.variants.filter((v) => v.isLive)).toHaveLength(1);
    expect(liveVariant(pos2)?.slideId).toBe('s2b');
  });
  it('unknown slideId → unchanged (never leaves a position with no live variant)', () => {
    const out = setLiveVariant(deck(), 2, 'nope');
    expect(liveVariant(out.find((s) => s.position === 2)!)?.slideId).toBe('s2a');
  });
});

describe('setViewing — exactly one version viewing', () => {
  const versions: DeckVersionRef[] = [
    { versionId: 'V1', label: 'V1', isViewing: false, feedbackCount: 2 },
    { versionId: 'V2', label: 'V2', isViewing: true, feedbackCount: 0 }
  ];
  it('switches the viewing flag to exactly one version', () => {
    const out = setViewing(versions, 'V1');
    expect(out.filter((v) => v.isViewing).map((v) => v.versionId)).toEqual(['V1']);
  });
  it('unknown version id → unchanged (never zero viewing)', () => {
    expect(setViewing(versions, 'V9').filter((v) => v.isViewing)).toHaveLength(1);
  });
});
