import { describe, it, expect } from 'vitest';
import {
  SERVER_VERSION,
  getFeaturesForTier,
  getFeatureFlagsForTier,
  getLimitsForTier,
  getMigrationCompatibility,
  getBranding,
} from './featureGates';

describe('featureGates', () => {
  it('SERVER_VERSION is a semver string', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('getFeaturesForTier oss includes core features', () => {
    const f = getFeaturesForTier('oss');
    expect(f.oss).toContain('chat');
    expect(f.oss).toContain('rooms');
    expect(f.native).toHaveLength(0);
    expect(f.enterprise).toHaveLength(0);
  });

  it('getFeaturesForTier native includes native features', () => {
    const f = getFeaturesForTier('native');
    expect(f.native).toContain('chair');
    expect(f.native).toContain('qr_pairing');
  });

  it('getFeaturesForTier enterprise includes all tiers', () => {
    const f = getFeaturesForTier('enterprise');
    expect(f.oss.length).toBeGreaterThan(0);
    expect(f.native.length).toBeGreaterThan(0);
    expect(f.enterprise).toContain('sso');
    expect(f.enterprise).toContain('tenant_isolation');
  });

  it('getFeatureFlagsForTier oss has chair_api=true', () => {
    const flags = getFeatureFlagsForTier('oss');
    expect(flags.chair_api).toBe(true);
    expect(flags.chair_ux).toBe(false);
    expect(flags.sso).toBe(false);
  });

  it('getFeatureFlagsForTier native unlocks premium flags', () => {
    const flags = getFeatureFlagsForTier('native');
    expect(flags.chair_ux).toBe(true);
    expect(flags.voice).toBe(true);
    expect(flags.sso).toBe(false);
  });

  it('getFeatureFlagsForTier enterprise unlocks all flags', () => {
    const flags = getFeatureFlagsForTier('enterprise');
    expect(flags.sso).toBe(true);
    expect(flags.tenant_isolation).toBe(true);
    expect(flags.policy_controls).toBe(true);
  });

  it('getLimitsForTier oss has lower limits', () => {
    const limits = getLimitsForTier('oss');
    expect(limits.maxRooms).toBe(10);
    expect(limits.messageRetentionDays).toBe(30);
  });

  it('getLimitsForTier native has higher limits', () => {
    const limits = getLimitsForTier('native');
    expect(limits.maxRooms).toBe(50);
    expect(limits.messageRetentionDays).toBe(90);
  });

  it('getLimitsForTier enterprise has unlimited', () => {
    const limits = getLimitsForTier('enterprise');
    expect(limits.maxRooms).toBeNull();
    expect(limits.maxTerminals).toBeNull();
    expect(limits.maxAgentsPerRoom).toBeNull();
  });

  it('getBranding oss returns ANT', () => {
    const b = getBranding();
    expect(b.productName).toBe('ANT');
    expect(b.upgradeCta).toBe('Upgrade to Pro');
  });

  it('getMigrationCompatibility has minClientVersion', () => {
    const m = getMigrationCompatibility();
    expect(m.minClientVersion).toBe('4.0.0');
  });
});
