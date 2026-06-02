import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  claimHandle,
  removeHandle,
  displayHandleForSession,
  listLeases,
  isMember,
  resolveMember
} from './roomHandleLeaseClean';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-lease-clean-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('roomHandleLeaseClean — basic claim', () => {
  it('first claimant of a free handle gets the clean @x (suffix 0)', () => {
    expect(claimHandle('roomX', '@x', 'sessA')).toBe('@x');
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x');
    expect(isMember('roomX', 'sessA')).toBe(true);
    expect(resolveMember('roomX', '@x')).toBe('sessA');
  });

  it('@-normalises a raw handle (x and @x are the same base)', () => {
    expect(claimHandle('roomX', 'x', 'sessA')).toBe('@x');
    expect(resolveMember('roomX', '@x')).toBe('sessA');
    // a second claimant on the un-prefixed form collides with the same base
    expect(claimHandle('roomX', 'x', 'sessB')).toBe('@x-1');
  });

  it('re-claim by the SAME clean holder is idempotent (stays @x)', () => {
    expect(claimHandle('roomX', '@x', 'sessA')).toBe('@x');
    expect(claimHandle('roomX', '@x', 'sessA')).toBe('@x');
    expect(listLeases('roomX').filter((l) => l.active)).toHaveLength(1);
  });
});

describe('roomHandleLeaseClean — Rule 2 (remove suffixes the incumbent, frees @x)', () => {
  it('removeHandle retires the clean holder to @x-1 and frees @x for a new claimant', () => {
    claimHandle('roomX', '@x', 'sessA');
    // `ant room X remove @x`
    expect(removeHandle('roomX', '@x')).toBe('@x-1');
    // A now renders as @x-1 (historical posts), and is no longer a clean member
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x-1');
    expect(isMember('roomX', 'sessA')).toBe(false);
    expect(resolveMember('roomX', '@x')).toBeNull();
    // @x is now free; B claims it clean
    expect(claimHandle('roomX', '@x', 'sessB')).toBe('@x');
    expect(resolveMember('roomX', '@x')).toBe('sessB');
  });

  it('removeHandle returns null when there is no active clean holder', () => {
    expect(removeHandle('roomX', '@x')).toBeNull();
  });
});

describe('roomHandleLeaseClean — Rule 3 (same session reverts to clean; STABLE suffix)', () => {
  it('a removed session re-claiming @x reverts to clean @x and demotes the current holder', () => {
    claimHandle('roomX', '@x', 'sessA');
    expect(removeHandle('roomX', '@x')).toBe('@x-1'); // A -> @x-1
    claimHandle('roomX', '@x', 'sessB'); // B takes clean @x
    expect(displayHandleForSession('roomX', 'sessB')).toBe('@x');

    // A (the original) re-claims @x -> reverts to clean @x, demotes B
    expect(claimHandle('roomX', '@x', 'sessA')).toBe('@x');
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x');
    expect(resolveMember('roomX', '@x')).toBe('sessA');
    // B is demoted to a suffix (the lowest free one)
    expect(displayHandleForSession('roomX', 'sessB')).toBe('@x-1');
  });

  it('STABLE: A removed (@x-1) then re-added then re-removed keeps @x-1, never @x-2', () => {
    claimHandle('roomX', '@x', 'sessA');
    expect(removeHandle('roomX', '@x')).toBe('@x-1'); // A's assigned suffix = 1
    expect(claimHandle('roomX', '@x', 'sessA')).toBe('@x'); // revert to clean
    // re-remove A: its STABLE assigned suffix stays 1
    expect(removeHandle('roomX', '@x')).toBe('@x-1');
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x-1');
  });

  it('a DIFFERENT session re-claiming does NOT revert — it gets a suffix', () => {
    claimHandle('roomX', '@x', 'sessA');
    removeHandle('roomX', '@x'); // A retired to @x-1 (inactive), @x free
    claimHandle('roomX', '@x', 'sessB'); // B clean @x
    // sessC (never held @x) claims -> a suffix, does NOT steal clean @x. A's
    // @x-1 is retired (inactive) so it frees that slot; C takes lowest-free @x-1.
    expect(claimHandle('roomX', '@x', 'sessC')).toBe('@x-1');
    expect(displayHandleForSession('roomX', 'sessB')).toBe('@x'); // B keeps clean
    // and A — never re-claimed by its own session — keeps its history @x-1
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x-1');
  });
});

describe('roomHandleLeaseClean — Rule 4 (collision = lowest free suffix, NO error)', () => {
  it('concurrent claimants get @x, @x-1, @x-2 with no error', () => {
    expect(claimHandle('roomX', '@x', 'sessA')).toBe('@x');
    expect(claimHandle('roomX', '@x', 'sessB')).toBe('@x-1');
    expect(claimHandle('roomX', '@x', 'sessC')).toBe('@x-2');
  });

  it('lowest-free fills gaps left by a removed suffix holder', () => {
    claimHandle('roomX', '@x', 'sessA'); // @x
    claimHandle('roomX', '@x', 'sessB'); // @x-1
    claimHandle('roomX', '@x', 'sessC'); // @x-2
    // sessB had @x-1; remove the clean @x holder (A) -> A gets @x-3 (next free
    // beyond the live 1,2), and @x is freed. We then claim a fresh session and
    // it should take the freed clean @x (Rule 2 frees suffix 0).
    expect(removeHandle('roomX', '@x')).toBe('@x-3');
    expect(claimHandle('roomX', '@x', 'sessD')).toBe('@x');
  });
});

describe('roomHandleLeaseClean — Rule 1 / stability / isolation', () => {
  it('removing an unrelated holder does not renumber others', () => {
    claimHandle('roomX', '@x', 'sessA'); // @x
    claimHandle('roomX', '@x', 'sessB'); // @x-1
    claimHandle('roomX', '@x', 'sessC'); // @x-2
    // remove a different handle entirely — no effect on @x leases
    claimHandle('roomX', '@y', 'sessD');
    removeHandle('roomX', '@y');
    expect(displayHandleForSession('roomX', 'sessB')).toBe('@x-1');
    expect(displayHandleForSession('roomX', 'sessC')).toBe('@x-2');
  });

  it('handles are independent across rooms', () => {
    claimHandle('roomX', '@x', 'sessA');
    claimHandle('roomY', '@x', 'sessA');
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x');
    expect(displayHandleForSession('roomY', 'sessA')).toBe('@x');
    // removing in room X does not affect room Y
    removeHandle('roomX', '@x');
    expect(displayHandleForSession('roomX', 'sessA')).toBe('@x-1');
    expect(displayHandleForSession('roomY', 'sessA')).toBe('@x');
  });

  it('INVARIANT: at most one active suffix-0 holder per (room,handle)', () => {
    claimHandle('roomX', '@x', 'sessA');
    claimHandle('roomX', '@x', 'sessB');
    claimHandle('roomX', '@x', 'sessC');
    const cleanHolders = listLeases('roomX').filter((l) => l.active && l.suffix === 0 && l.handle === '@x');
    expect(cleanHolders).toHaveLength(1);
  });
});
