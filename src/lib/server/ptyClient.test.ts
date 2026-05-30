import { describe, expect, it } from 'vitest';
import type { Stats } from 'node:fs';
import { _resolveReadPlan } from './ptyClient';

// Minimal Stats stand-in — _resolveReadPlan only reads .size and .ino.
function st(size: number, ino: number): Stats {
  return { size, ino } as unknown as Stats;
}

describe('_resolveReadPlan — .out recovery decision matrix', () => {
  it('pure append: reads from the stored offset, no reset', () => {
    // File grew 100 → 250, same inode. Normal live tail.
    const plan = _resolveReadPlan(100, 42, st(250, 42));
    expect(plan).toEqual({ from: 100, reset: false });
  });

  it('no growth: reads from the stored offset, no reset (drain no-ops downstream)', () => {
    const plan = _resolveReadPlan(100, 42, st(100, 42));
    expect(plan).toEqual({ from: 100, reset: false });
  });

  it('truncation: file shrank below our offset → reset, resume from new end', () => {
    // The bug this fixes: without recovery, offset 500 > size 30 means
    // `size <= offset` mutes the session forever. We resume from 30.
    const plan = _resolveReadPlan(500, 42, st(30, 42));
    expect(plan).toEqual({ from: 30, reset: true });
  });

  it('rotation: same size but inode changed → reset (file replaced under us)', () => {
    const plan = _resolveReadPlan(500, 42, st(500, 99));
    expect(plan).toEqual({ from: 500, reset: true });
  });

  it('first read (prevIno unknown = 0): never treats an inode mismatch as rotation', () => {
    // Seeded session with no recorded inode yet — a fresh, larger file must
    // read as a normal append, not a spurious reset.
    const plan = _resolveReadPlan(0, 0, st(120, 77));
    expect(plan).toEqual({ from: 0, reset: false });
  });

  it('truncation to exactly zero (file emptied) → reset from 0', () => {
    const plan = _resolveReadPlan(500, 42, st(0, 42));
    expect(plan).toEqual({ from: 0, reset: true });
  });
});
