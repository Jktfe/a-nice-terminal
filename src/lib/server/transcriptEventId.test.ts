import { describe, expect, it } from 'vitest';
import { transcriptEventKey } from './transcriptEventId';

describe('transcriptEventKey', () => {
  it('uses nativeId when present', () => {
    const key = transcriptEventKey('abc-123', 'some raw line', 0);
    expect(key).toBe('abc-123#0');
  });

  it('falls back to hash when nativeId is null', () => {
    const key = transcriptEventKey(null, 'some raw line', 0);
    expect(key).toMatch(/^h[0-9a-f]+#0$/);
  });

  it('falls back to hash when nativeId is empty', () => {
    const key = transcriptEventKey('', 'some raw line', 0);
    expect(key).toMatch(/^h[0-9a-f]+#0$/);
  });

  it('appends index suffix', () => {
    const key = transcriptEventKey('abc-123', 'line', 3);
    expect(key).toBe('abc-123#3');
  });

  it('same raw line produces same hash', () => {
    const key1 = transcriptEventKey(null, 'identical line', 0);
    const key2 = transcriptEventKey(null, 'identical line', 0);
    expect(key1).toBe(key2);
  });

  it('different raw lines produce different hashes', () => {
    const key1 = transcriptEventKey(null, 'line a', 0);
    const key2 = transcriptEventKey(null, 'line b', 0);
    expect(key1).not.toBe(key2);
  });
});
