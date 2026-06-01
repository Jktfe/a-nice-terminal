/**
 * handleValidation tests — Fix #3 of sec-iter1 (2026-05-30 enterprise
 * security pass / M13 reserved-list enforcement).
 *
 * Covers:
 *   - happy path (canonical with + without leading @)
 *   - empty / whitespace / non-string rejected
 *   - too-short / too-long bounds
 *   - reserved-handle list, case-insensitive
 *   - invalid character classes (spaces, slashes, leading/trailing dot/dash)
 *   - loadReservedHandles / normaliseHandle / isReservedHandle helpers
 */

import { describe, expect, it } from 'vitest';
import {
  isReservedHandle,
  loadReservedHandles,
  normaliseHandle,
  validateHandleForRegistration
} from './handleValidation';

describe('handleValidation — happy path', () => {
  it('accepts a simple handle with leading @', () => {
    const result = validateHandleForRegistration('@speedyc');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonicalHandle).toBe('@speedyc');
  });

  it('accepts a handle without leading @ and normalises', () => {
    const result = validateHandleForRegistration('speedyc');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonicalHandle).toBe('@speedyc');
  });

  it('accepts handles containing dashes, underscores, dots inside', () => {
    const cases = ['@a.b', '@a-b', '@a_b', '@a1.b2-c3_d4'];
    for (const h of cases) {
      const result = validateHandleForRegistration(h);
      expect(result.ok, `case ${h}`).toBe(true);
    }
  });

  it('trims surrounding whitespace', () => {
    const result = validateHandleForRegistration('  @neat  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonicalHandle).toBe('@neat');
  });
});

describe('handleValidation — empty + non-string rejections', () => {
  it('rejects null', () => {
    const result = validateHandleForRegistration(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('rejects undefined', () => {
    const result = validateHandleForRegistration(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('rejects empty string', () => {
    const result = validateHandleForRegistration('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('rejects whitespace-only string', () => {
    const result = validateHandleForRegistration('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('rejects non-string types (number)', () => {
    const result = validateHandleForRegistration(123 as unknown as string);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });
});

describe('handleValidation — length bounds', () => {
  it('rejects too-short (just "@" expands to length 1)', () => {
    const result = validateHandleForRegistration('@');
    // '@' alone normalises to '@', length 1 — fails the too_short check.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_short');
  });

  it('accepts the minimum length handle (@a)', () => {
    const result = validateHandleForRegistration('@a');
    expect(result.ok).toBe(true);
  });

  it('rejects too-long (>64 chars including @)', () => {
    // 64 chars including @ = local part of 63
    const localPart64 = 'a'.repeat(64);
    const result = validateHandleForRegistration(`@${localPart64}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_long');
  });

  it('accepts a handle at exactly the max length (64 incl @)', () => {
    const localPart63 = 'a'.repeat(63);
    const result = validateHandleForRegistration(`@${localPart63}`);
    expect(result.ok).toBe(true);
  });
});

describe('handleValidation — reserved list', () => {
  it('loadReservedHandles returns all 16 entries', () => {
    const set = loadReservedHandles();
    expect(set.size).toBeGreaterThanOrEqual(16);
    expect(set.has('@admin')).toBe(true);
    expect(set.has('@you')).toBe(true);
    expect(set.has('@everyone')).toBe(true);
    expect(set.has('@antchair')).toBe(true);
  });

  it('isReservedHandle is case-insensitive', () => {
    expect(isReservedHandle('@admin')).toBe(true);
    expect(isReservedHandle('@Admin')).toBe(true);
    expect(isReservedHandle('@ADMIN')).toBe(true);
    expect(isReservedHandle('admin')).toBe(true); // no leading @
  });

  it('isReservedHandle returns false for non-reserved handles', () => {
    expect(isReservedHandle('@speedyc')).toBe(false);
    expect(isReservedHandle('@jwpk')).toBe(false);
    expect(isReservedHandle('@claudev4')).toBe(false);
  });

  it('validateHandleForRegistration rejects every reserved entry', () => {
    const reserved = [
      '@you',
      '@me',
      '@everyone',
      '@here',
      '@anyone',
      '@broadcast',
      '@any',
      '@all',
      '@channel',
      '@system',
      '@ant',
      '@nobody',
      '@null',
      '@admin',
      '@antadmin',
      '@chair',
      '@antchair'
    ];
    for (const h of reserved) {
      const result = validateHandleForRegistration(h);
      expect(result.ok, `case ${h}`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('reserved');
    }
  });

  it('rejects reserved handles regardless of case + leading-@', () => {
    const variants = ['@Admin', '@ADMIN', 'admin', 'Admin', 'ADMIN'];
    for (const v of variants) {
      const result = validateHandleForRegistration(v);
      expect(result.ok, `case ${v}`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('reserved');
    }
  });
});

describe('handleValidation — character whitelist', () => {
  it('rejects handles with spaces', () => {
    const result = validateHandleForRegistration('@bad name');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_characters');
  });

  it('rejects handles with slashes', () => {
    const result = validateHandleForRegistration('@bad/name');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_characters');
  });

  it('rejects handles with control characters', () => {
    const result = validateHandleForRegistration('@bad\nname');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_characters');
  });

  it('rejects leading dot or dash in local part', () => {
    expect(validateHandleForRegistration('@.bad').ok).toBe(false);
    expect(validateHandleForRegistration('@-bad').ok).toBe(false);
  });

  it('rejects trailing dot or dash in local part', () => {
    expect(validateHandleForRegistration('@bad.').ok).toBe(false);
    expect(validateHandleForRegistration('@bad-').ok).toBe(false);
  });

  it('rejects unicode (non-ASCII) characters', () => {
    const result = validateHandleForRegistration('@hé');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_characters');
  });
});

describe('handleValidation — normaliseHandle helper', () => {
  it('adds leading @ when missing', () => {
    expect(normaliseHandle('speedyc')).toBe('@speedyc');
  });

  it('preserves leading @ when present', () => {
    expect(normaliseHandle('@speedyc')).toBe('@speedyc');
  });

  it('trims whitespace', () => {
    expect(normaliseHandle('  speedyc  ')).toBe('@speedyc');
  });

  it('returns empty for empty input', () => {
    expect(normaliseHandle('')).toBe('');
    expect(normaliseHandle('   ')).toBe('');
  });
});
