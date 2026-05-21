import { describe, expect, it } from 'vitest';
import { SPECIAL_KEYS, PASTE_SENTINEL, getKeySequence } from './specialKeys';

describe('specialKeys', () => {
  it('has 10 special keys', () => {
    expect(SPECIAL_KEYS).toHaveLength(10);
  });

  it('finds key sequence by cli name', () => {
    expect(getKeySequence('ctrl-c')).toBe('\x03');
    expect(getKeySequence('enter')).toBe('\r');
    expect(getKeySequence('tab')).toBe('\t');
    expect(getKeySequence('left')).toBe('\x1b[D');
    expect(getKeySequence('right')).toBe('\x1b[C');
    expect(getKeySequence('up')).toBe('\x1b[A');
    expect(getKeySequence('down')).toBe('\x1b[B');
    expect(getKeySequence('escape')).toBe('\x1b');
    expect(getKeySequence('shift-tab')).toBe('\x1b[Z');
    expect(getKeySequence('paste')).toBe('__paste__');
  });

  it('returns null for unknown cli name', () => {
    expect(getKeySequence('unknown')).toBeNull();
    expect(getKeySequence('')).toBeNull();
  });

  it('paste sentinel is exported', () => {
    expect(PASTE_SENTINEL).toBe('__paste__');
    expect(SPECIAL_KEYS.some((k) => k.seq === PASTE_SENTINEL)).toBe(true);
  });

  it('every key has label, seq, and cli', () => {
    for (const key of SPECIAL_KEYS) {
      expect(key.label).toBeTruthy();
      expect(key.seq).toBeTruthy();
      expect(key.cli).toBeTruthy();
    }
  });
});
