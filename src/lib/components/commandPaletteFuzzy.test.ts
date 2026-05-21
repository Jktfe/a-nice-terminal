import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './commandPaletteFuzzy';

describe('fuzzyMatch', () => {
  it('matches a contiguous substring', () => {
    expect(fuzzyMatch('ant', 'antv4')).toBe(true);
  });

  it('matches characters spread across the haystack', () => {
    expect(fuzzyMatch('v4f', 'v4-fresh-ant')).toBe(true);
    expect(fuzzyMatch('cmd', 'composer-command-line')).toBe(true);
  });

  it('respects order: characters must appear in sequence', () => {
    expect(fuzzyMatch('4v', 'v4-fresh-ant')).toBe(false);
  });

  it('returns true for an empty query (all items pass)', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });

  it('returns false when a character is missing', () => {
    expect(fuzzyMatch('xyz', 'antv4')).toBe(false);
  });

  it('is case-sensitive — the caller lowercases before matching', () => {
    expect(fuzzyMatch('A', 'antv4')).toBe(false);
    expect(fuzzyMatch('a', 'antv4')).toBe(true);
  });
});
