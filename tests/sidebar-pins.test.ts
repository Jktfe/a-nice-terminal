import { describe, expect, it } from 'vitest';
import { parsePinnedIds, togglePinnedId } from '../src/lib/utils/sidebar-pins.js';

describe('sidebar pin helpers', () => {
  it('parses only non-empty string ids from localStorage JSON', () => {
    expect(Array.from(parsePinnedIds('["a",2,"","b",null]'))).toEqual(['a', 'b']);
  });

  it('falls back to an empty set for malformed storage values', () => {
    expect(Array.from(parsePinnedIds('{not json'))).toEqual([]);
  });

  it('places newly pinned terminals at the front without mutating the previous set', () => {
    const previous = new Set(['a']);
    const next = togglePinnedId(previous, 'b');
    expect(Array.from(previous)).toEqual(['a']);
    expect(Array.from(next)).toEqual(['b', 'a']);
  });

  it('removes existing pins', () => {
    expect(Array.from(togglePinnedId(new Set(['b', 'a']), 'b'))).toEqual(['a']);
  });
});
