import { describe, it, expect } from 'vitest';
import { createAskId } from '../src/lib/server/ask-ids.js';

describe('ask-ids', () => {
  it('returns an id starting with A', () => {
    const id = createAskId();
    expect(id.startsWith('A')).toBe(true);
  });

  it('returns an 8-character id (A + 7 suffix)', () => {
    const id = createAskId();
    expect(id.length).toBe(8);
  });

  it('uses only allowed characters after the A', () => {
    const id = createAskId();
    const suffix = id.slice(1);
    expect(suffix).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/);
  });

  it('returns different ids on successive calls', () => {
    const ids = new Set(Array.from({ length: 20 }, createAskId));
    expect(ids.size).toBe(20);
  });
});
