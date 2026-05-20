import { describe, expect, it } from 'vitest';
import { classifyStateFreshness, STATE_FRESHNESS_LIVE_MS } from './state-freshness';

describe('state-freshness', () => {
  it('classifies absent when mtimeMs is undefined', () => {
    expect(classifyStateFreshness(undefined)).toBe('absent');
  });

  it('classifies absent when mtimeMs is non-finite', () => {
    expect(classifyStateFreshness(NaN)).toBe('absent');
    expect(classifyStateFreshness(Infinity)).toBe('absent');
    expect(classifyStateFreshness(-Infinity)).toBe('absent');
  });

  it('classifies live when within window', () => {
    const now = 1_000_000;
    expect(classifyStateFreshness(now - 1, now)).toBe('live');
    expect(classifyStateFreshness(now - STATE_FRESHNESS_LIVE_MS + 1, now)).toBe('live');
  });

  it('classifies stale when outside window', () => {
    const now = 1_000_000;
    expect(classifyStateFreshness(now - STATE_FRESHNESS_LIVE_MS, now)).toBe('stale');
    expect(classifyStateFreshness(now - STATE_FRESHNESS_LIVE_MS - 1, now)).toBe('stale');
    expect(classifyStateFreshness(0, now)).toBe('stale');
  });

  it('uses Date.now() as default now', () => {
    const recent = Date.now() - 1_000;
    expect(classifyStateFreshness(recent)).toBe('live');
  });
});
