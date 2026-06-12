import { describe, expect, it } from 'vitest';
import type { Stats } from 'node:fs';
import { _resolveReadPlan, _resolveTmuxBin } from './ptyClient';

// Minimal Stats stand-in — _resolveReadPlan only reads .size and .ino.
function st(size: number, ino: number): Stats {
  return { size, ino } as unknown as Stats;
}

describe('_resolveReadPlan — .out recovery decision matrix', () => {
  it('pure append: reads from the stored offset, no reset', () => {
    // File grew 100 → 250, same inode. Normal live tail.
    const plan = _resolveReadPlan(100, 42, st(250, 42));
    expect(plan).toEqual({ from: 100, reset: false, skippedOversizedAppend: false });
  });

  it('no growth: reads from the stored offset, no reset (drain no-ops downstream)', () => {
    const plan = _resolveReadPlan(100, 42, st(100, 42));
    expect(plan).toEqual({ from: 100, reset: false, skippedOversizedAppend: false });
  });

  it('truncation: file shrank below our offset → reset, resume from new end', () => {
    // The bug this fixes: without recovery, offset 500 > size 30 means
    // `size <= offset` mutes the session forever. We resume from 30.
    const plan = _resolveReadPlan(500, 42, st(30, 42));
    expect(plan).toEqual({ from: 30, reset: true, skippedOversizedAppend: false });
  });

  it('rotation: same size but inode changed → reset (file replaced under us)', () => {
    const plan = _resolveReadPlan(500, 42, st(500, 99));
    expect(plan).toEqual({ from: 500, reset: true, skippedOversizedAppend: false });
  });

  it('first read (prevIno unknown = 0): never treats an inode mismatch as rotation', () => {
    // Seeded session with no recorded inode yet — a fresh, larger file must
    // read as a normal append, not a spurious reset.
    const plan = _resolveReadPlan(0, 0, st(120, 77));
    expect(plan).toEqual({ from: 0, reset: false, skippedOversizedAppend: false });
  });

  it('truncation to exactly zero (file emptied) → reset from 0', () => {
    const plan = _resolveReadPlan(500, 42, st(0, 42));
    expect(plan).toEqual({ from: 0, reset: true, skippedOversizedAppend: false });
  });

  it('oversized append: resets to EOF instead of replaying a giant chunk through the server', () => {
    const plan = _resolveReadPlan(100, 42, st(10_000, 42), 1024);
    expect(plan).toEqual({ from: 10_000, reset: true, skippedOversizedAppend: true });
  });
});

describe('_resolveTmuxBin — tmux binary resolution order', () => {
  it('ANT_TMUX_BIN env override wins over every existing well-known path', () => {
    const bin = _resolveTmuxBin({ ANT_TMUX_BIN: '/custom/tmux' }, () => true);
    expect(bin).toBe('/custom/tmux');
  });

  it('Apple Silicon Homebrew path preferred when both well-known paths exist', () => {
    const bin = _resolveTmuxBin({}, () => true);
    expect(bin).toBe('/opt/homebrew/bin/tmux');
  });

  it('falls back to /usr/local/bin/tmux on Intel Macs (no /opt/homebrew install)', () => {
    // The audit bug: this machine class lost terminals entirely under the
    // hardcoded /opt/homebrew path.
    const bin = _resolveTmuxBin({}, (path) => path === '/usr/local/bin/tmux');
    expect(bin).toBe('/usr/local/bin/tmux');
  });

  it('falls back to bare "tmux" (PATH lookup) when no well-known path exists', () => {
    const bin = _resolveTmuxBin({}, () => false);
    expect(bin).toBe('tmux');
  });

  it('empty-string ANT_TMUX_BIN is treated as unset (truthy guard — deliberately stricter than the ?? sites, which would spawn "")', () => {
    const bin = _resolveTmuxBin({ ANT_TMUX_BIN: '' }, (path) => path === '/usr/local/bin/tmux');
    expect(bin).toBe('/usr/local/bin/tmux');
  });
});
