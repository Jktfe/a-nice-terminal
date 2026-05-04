import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../src/lib/utils/viewport';

describe('viewport metrics', () => {
  it('reports zero keyboard height when visual viewport matches the layout viewport', () => {
    expect(computeViewportMetrics({ innerHeight: 844, innerWidth: 390 })).toEqual({
      viewportHeight: 844,
      viewportWidth: 390,
      viewportOffsetTop: 0,
      viewportOffsetLeft: 0,
      keyboardHeight: 0,
    });
  });

  it('derives keyboard height from the reduced visual viewport', () => {
    expect(computeViewportMetrics({
      innerHeight: 844,
      innerWidth: 390,
      viewportHeight: 520,
      viewportWidth: 390,
      offsetTop: 0,
    }).keyboardHeight).toBe(324);
  });

  it('accounts for top offset when browser chrome shifts the viewport', () => {
    expect(computeViewportMetrics({
      innerHeight: 844,
      innerWidth: 390,
      viewportHeight: 520,
      viewportWidth: 390,
      offsetTop: 44,
    }).keyboardHeight).toBe(280);
  });
});
