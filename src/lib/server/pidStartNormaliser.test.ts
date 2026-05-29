import { describe, expect, it } from 'vitest';
import { normalisePidStartToIso8601 } from './pidStartNormaliser';

describe('normalisePidStartToIso8601', () => {
  it('normalises macOS day-month locale string to ISO 8601 UTC', () => {
    // en_GB.UTF-8 ordering: weekday day month time year
    const out = normalisePidStartToIso8601('Fri 29 May 11:11:24 2026');
    expect(out).not.toBeNull();
    expect(out).toMatch(/^2026-05-29T/);
    expect(out!.endsWith('Z')).toBe(true);
  });

  it('normalises macOS month-day locale string to the SAME ISO 8601 value', () => {
    // en_US.UTF-8 ordering: weekday month day time year — different
    // string, same wall-clock moment. This is the regression for the
    // 2026-05-29 4-hour silence forensic.
    const a = normalisePidStartToIso8601('Fri 29 May 11:11:24 2026');
    const b = normalisePidStartToIso8601('Thu May 29 11:11:24 2026');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBe(b);
  });

  it('passes already-ISO Windows PowerShell output through verbatim', () => {
    // .NET .ToString('o') round-trip format — sub-second precision + offset
    const input = '2026-05-29T11:11:24.1234567+01:00';
    expect(normalisePidStartToIso8601(input)).toBe(input);
  });

  it('trims surrounding whitespace on already-ISO input', () => {
    const input = '  2026-05-29T11:11:24.000Z  ';
    expect(normalisePidStartToIso8601(input)).toBe('2026-05-29T11:11:24.000Z');
  });

  it('returns null for null / undefined / empty string', () => {
    expect(normalisePidStartToIso8601(null)).toBeNull();
    expect(normalisePidStartToIso8601(undefined)).toBeNull();
    expect(normalisePidStartToIso8601('')).toBeNull();
    expect(normalisePidStartToIso8601('   ')).toBeNull();
  });

  it('returns null for non-string input (defensive — caller may pass garbage)', () => {
    // @ts-expect-error — intentionally probing runtime resilience
    expect(normalisePidStartToIso8601(12345)).toBeNull();
    // @ts-expect-error — intentionally probing runtime resilience
    expect(normalisePidStartToIso8601({ pid_start: 'x' })).toBeNull();
  });

  it('returns null for unparseable garbage (no throw)', () => {
    expect(normalisePidStartToIso8601('not a date')).toBeNull();
    expect(normalisePidStartToIso8601('???')).toBeNull();
  });
});
