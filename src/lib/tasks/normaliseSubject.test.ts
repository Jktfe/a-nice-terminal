import { describe, expect, it } from 'vitest';
import { normaliseSubject } from './normaliseSubject';

describe('normaliseSubject', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(normaliseSubject(null)).toBe('');
    expect(normaliseSubject(undefined)).toBe('');
    expect(normaliseSubject('')).toBe('');
  });

  it('trims leading + trailing whitespace', () => {
    expect(normaliseSubject('  refactor auth  ')).toBe('refactor auth');
  });

  it('collapses internal whitespace runs', () => {
    expect(normaliseSubject('refactor   auth\tmodule')).toBe('refactor auth module');
  });

  it('collapses newlines into a single space', () => {
    expect(normaliseSubject('refactor\nauth')).toBe('refactor auth');
  });

  it('strips a leading bullet from pasted todo lines', () => {
    expect(normaliseSubject('• refactor auth')).toBe('refactor auth');
    expect(normaliseSubject('- refactor auth')).toBe('refactor auth');
    expect(normaliseSubject('* refactor auth')).toBe('refactor auth');
  });

  it('does not strip bullets that appear mid-string', () => {
    expect(normaliseSubject('plan A • plan B')).toBe('plan A • plan B');
  });

  it('does not over-strip — bullet without trailing space stays', () => {
    expect(normaliseSubject('-foo')).toBe('-foo');
  });
});
