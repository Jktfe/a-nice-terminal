/**
 * B-HARDEN-sessionid-pk S2 — terminal→CLI-sessionId resolver tests.
 * PsRunner is injected (no live ps); HOME-isolated state dir per the
 * codex2-hardened agentStateReader pattern (do not regress that).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as os from 'node:os';
import { _clearStateReaderCache } from './agentStateReader';
import { resolvePidAncestry, resolveTerminalSessionId } from './terminalSessionLink';
import type { PsRunner } from './fingerprintDetector';

const ORIG_HOME = os.homedir();

// Synthetic process tree: pid -> ppid.
function psFromTree(tree: Record<number, number>): PsRunner {
  return (pid: number) =>
    pid in tree ? { ppid: tree[pid], comm: `p${pid}` } : null;
}

describe('resolvePidAncestry', () => {
  it('walks ppid up to the root, cycle-safe + depth-bounded', () => {
    const ps = psFromTree({ 500: 400, 400: 300, 300: 1 });
    expect(resolvePidAncestry(500, ps)).toEqual([500, 400, 300]);
  });
  it('stops on a cycle without looping forever', () => {
    const ps = psFromTree({ 10: 20, 20: 10 });
    expect(resolvePidAncestry(10, ps)).toEqual([10, 20]);
  });
  it('returns [pid] when ps has no record', () => {
    expect(resolvePidAncestry(999, () => null)).toEqual([999]);
  });
});

describe('resolveTerminalSessionId', () => {
  let homeDir: string;
  let piDir: string;
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tsl-'));
    piDir = join(homeDir, '.ant', 'state', 'pi');
    mkdirSync(piDir, { recursive: true });
    process.env.HOME = homeDir;
    _clearStateReaderCache();
  });
  afterEach(() => {
    process.env.HOME = ORIG_HOME;
    rmSync(homeDir, { recursive: true, force: true });
  });

  function writeState(sid: string, body: Record<string, unknown>, mtimeS?: number) {
    const p = join(piDir, `${sid}.json`);
    writeFileSync(p, JSON.stringify(body));
    if (mtimeS !== undefined) utimesSync(p, mtimeS, mtimeS);
  }

  it('matches via pid-subtree (state pid is a descendant of terminal pid)', () => {
    writeState('sid-A', { state: 'Working', cwd: '/x', pid: 900 });
    // 900 -> 800 -> 700(terminal)
    const ps = psFromTree({ 900: 800, 800: 700, 700: 1 });
    const m = resolveTerminalSessionId('pi', 700, { psRunner: ps });
    expect(m?.sessionId).toBe('sid-A');
    expect(m?.via).toBe('pid-subtree');
  });

  it('D-COLLISION: multiple pid-matches → newest mtime wins', () => {
    writeState('old', { state: 'Working', cwd: '/x', pid: 901 }, Date.now() / 1000 - 100);
    writeState('new', { state: 'Working', cwd: '/x', pid: 902 }, Date.now() / 1000);
    const ps = psFromTree({ 901: 700, 902: 700, 700: 1 });
    const m = resolveTerminalSessionId('pi', 700, { psRunner: ps });
    expect(m?.sessionId).toBe('new');
    expect(m?.via).toBe('pid-subtree');
  });

  it('no pid match → cwd fallback when cwd given', () => {
    writeState('cwd-sid', { state: 'Waiting', cwd: '/repo/proj' }); // no pid
    const ps = psFromTree({});
    const m = resolveTerminalSessionId('pi', 700, { psRunner: ps, cwd: '/repo/proj' });
    expect(m?.sessionId).toBe('cwd-sid');
    expect(m?.via).toBe('cwd-fallback');
  });

  it('pid match takes precedence over cwd fallback', () => {
    writeState('by-pid', { state: 'Working', cwd: '/other', pid: 950 });
    writeState('by-cwd', { state: 'Waiting', cwd: '/repo/proj' });
    const ps = psFromTree({ 950: 700, 700: 1 });
    const m = resolveTerminalSessionId('pi', 700, { psRunner: ps, cwd: '/repo/proj' });
    expect(m?.sessionId).toBe('by-pid');
    expect(m?.via).toBe('pid-subtree');
  });

  it('no pid match + no cwd → null (no false link)', () => {
    writeState('s', { state: 'Working', cwd: '/x', pid: 12345 });
    const ps = psFromTree({ 12345: 9999, 9999: 1 }); // never reaches 700
    expect(resolveTerminalSessionId('pi', 700, { psRunner: ps })).toBeNull();
  });

  it('pid present but unrelated subtree → not matched (no cwd) → null', () => {
    writeState('s', { state: 'Working', cwd: '/x', pid: 222 });
    const ps = psFromTree({ 222: 111, 111: 1 });
    expect(resolveTerminalSessionId('pi', 700, { psRunner: ps })).toBeNull();
  });
});
