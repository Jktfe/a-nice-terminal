import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAwayMode,
  listAwayModes,
  setAwayMode,
  clearAwayMode,
  isAllowedAwayTier,
  describeAwayTier
} from './awayModeStore';

describe('awayModeStore', () => {
  beforeEach(() => {
    clearAwayMode('@test-user');
    clearAwayMode('@other-user');
  });

  it('T1: tier guard + descriptions', () => {
    expect(isAllowedAwayTier('active')).toBe(true);
    expect(isAllowedAwayTier('away-desk')).toBe(true);
    expect(isAllowedAwayTier('away-phone')).toBe(true);
    expect(isAllowedAwayTier('invalid')).toBe(false);

    const desc = describeAwayTier('away-desk');
    expect(desc.label).toBe('Away from desk');
    expect(desc.typicalDuration).toContain('30 min');
  });

  it('T2: set + get round-trip', () => {
    const mode = setAwayMode({
      handle: '@test-user',
      tier: 'away-office',
      intensity: 75,
      note: 'Lunch break',
      expectedBackMs: Date.now() + 3600_000
    });
    expect(mode.tier).toBe('away-office');
    expect(mode.intensity).toBe(75);

    const fetched = getAwayMode('@test-user');
    expect(fetched?.tier).toBe('away-office');
    expect(fetched?.note).toBe('Lunch break');
  });

  it('T3: intensity clamped 0..100', () => {
    const low = setAwayMode({ handle: '@test-user', tier: 'away-desk', intensity: -10 });
    expect(low.intensity).toBe(0);

    const high = setAwayMode({ handle: '@test-user', tier: 'away-desk', intensity: 999 });
    expect(high.intensity).toBe(100);
  });

  it('T4: list with tier filter', () => {
    setAwayMode({ handle: '@test-user', tier: 'away-desk' });
    setAwayMode({ handle: '@other-user', tier: 'away-phone' });

    const deskModes = listAwayModes({ tier: 'away-desk' });
    expect(deskModes.some(m => m.handle === '@test-user')).toBe(true);
    expect(deskModes.every(m => m.tier === 'away-desk')).toBe(true);
  });

  it('T5: clear removes record', () => {
    setAwayMode({ handle: '@test-user', tier: 'away-desk' });
    expect(getAwayMode('@test-user')).toBeDefined();

    clearAwayMode('@test-user');
    expect(getAwayMode('@test-user')).toBeUndefined();
  });
});
