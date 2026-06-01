/**
 * AGENT-STATE-READER lift tests. Uses a temp HOME with a fake state
 * directory so tests don't depend on the live ~/.ant/state contents.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as os from 'node:os';
import {
  listSnapshots, findStateForSessionId, findStateForCwd,
  findStateForCwdBasename, _clearStateReaderCache,
  classifyStateFreshness, STATE_FRESHNESS_LIVE_MS
} from './agentStateReader';

const ORIG_HOME = os.homedir();

function setHome(h: string) {
  // homedir() reads $HOME on POSIX; override for the test span.
  process.env.HOME = h;
}

describe('classifyStateFreshness (re-export)', () => {
  it('returns absent when mtime undefined', () => {
    expect(classifyStateFreshness(undefined)).toBe('absent');
  });
  it('returns live within window', () => {
    expect(classifyStateFreshness(Date.now() - 1000)).toBe('live');
  });
  it('returns stale beyond window', () => {
    expect(classifyStateFreshness(Date.now() - STATE_FRESHNESS_LIVE_MS - 5000)).toBe('stale');
  });
});

describe('agentStateReader — file-based', () => {
  let homeDir: string;
  let cliDir: string;
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'astate-'));
    cliDir = join(homeDir, '.ant', 'state', 'claude-code');
    mkdirSync(cliDir, { recursive: true });
    setHome(homeDir);
    _clearStateReaderCache();
  });
  afterEach(() => {
    setHome(ORIG_HOME);
    rmSync(homeDir, { recursive: true, force: true });
  });

  function writeState(sessionId: string, body: Record<string, unknown>, mtimeS?: number): string {
    const path = join(cliDir, `${sessionId}.json`);
    writeFileSync(path, JSON.stringify(body));
    if (mtimeS !== undefined) utimesSync(path, mtimeS, mtimeS);
    return path;
  }

  it('listSnapshots reads state files for a CLI', () => {
    writeState('s1', { state: 'thinking', cwd: '/foo' });
    writeState('s2', { state: 'idle', cwd: '/bar' });
    const snaps = listSnapshots('claude-code');
    expect(snaps).toHaveLength(2);
    const labels = snaps.map((s) => s.stateLabel).sort();
    expect(labels).toEqual(['idle', 'thinking']);
  });

  it('findStateForSessionId returns matching snapshot', () => {
    writeState('sess-abc', { state: 'busy', cwd: '/x' });
    const snap = findStateForSessionId('claude-code', 'sess-abc');
    expect(snap?.sessionId).toBe('sess-abc');
    expect(snap?.stateLabel).toBe('busy');
    expect(snap?.cwd).toBe('/x');
  });

  it('findStateForSessionId returns null when missing', () => {
    expect(findStateForSessionId('claude-code', 'missing')).toBeNull();
  });

  it('findStateForCwd matches exact cwd, picks newest mtime', () => {
    writeState('older', { state: 'idle', cwd: '/p' }, Date.now() / 1000 - 100);
    writeState('newer', { state: 'thinking', cwd: '/p' }, Date.now() / 1000);
    const snap = findStateForCwd('claude-code', '/p');
    expect(snap?.sessionId).toBe('newer');
  });

  it('findStateForCwdBasename matches by basename, picks newest', () => {
    writeState('a', { state: 'idle', cwd: '/repo1/proj' });
    writeState('b', { state: 'thinking', cwd: '/repo2/proj' });
    const snap = findStateForCwdBasename('claude-code', 'proj');
    expect(snap).not.toBeNull();
  });

  it('parses ISO timestamps from raw fields', () => {
    writeState('ts', {
      state: 'idle', cwd: '/x',
      last_user_ts: '2026-05-15T00:00:00Z',
      last_resp_ts: '2026-05-15T00:00:30Z',
      session_start: '2026-05-15T00:00:00Z'
    });
    const snap = findStateForSessionId('claude-code', 'ts');
    expect(snap?.timestamps.sentAt).toBe(Date.parse('2026-05-15T00:00:00Z'));
    expect(snap?.timestamps.respAt).toBe(Date.parse('2026-05-15T00:00:30Z'));
    expect(snap?.sessionStartedAt).toBe(Date.parse('2026-05-15T00:00:00Z'));
  });

  it('exposes permissionMode + remoteControlActive when present', () => {
    writeState('flags', {
      state: 'idle', cwd: '/x',
      permission_mode: 'bypassPermissions',
      remote_control_active: true
    });
    const snap = findStateForSessionId('claude-code', 'flags');
    expect(snap?.permissionMode).toBe('bypassPermissions');
    expect(snap?.remoteControlActive).toBe(true);
  });

  it('returns null on malformed JSON', () => {
    const path = join(cliDir, 'bad.json');
    writeFileSync(path, '{bad json');
    expect(findStateForSessionId('claude-code', 'bad')).toBeNull();
  });
});

/**
 * Lane-E FINGERPRINT-MANIFEST consumer-side pin (researchant 2026-05-15).
 * Locks the READ side to the canonical schema from the gated decision-doc
 * docs/fingerprint-manifest-design-slice-1-2026-05-15.md so deepseek's pi
 * state-emitter (writing ~/.ant/state/pi/<sid>.json) has a verified
 * target. If this stays green, an emitter that produces this exact shape
 * is guaranteed to be readable by ANT.
 */
describe('agentStateReader — pi canonical-schema contract pin', () => {
  let homeDir: string;
  let piDir: string;
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'astate-pi-'));
    piDir = join(homeDir, '.ant', 'state', 'pi');
    mkdirSync(piDir, { recursive: true });
    setHome(homeDir);
    _clearStateReaderCache();
  });
  afterEach(() => {
    setHome(ORIG_HOME);
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('parses the full canonical pi state shape into AgentStateSnapshot', () => {
    writeFileSync(
      join(piDir, 'pi-sid-1.json'),
      JSON.stringify({
        state: 'Working',
        session_start: '2026-05-15T10:00:00Z',
        cwd: '/Users/x/proj',
        last_user_ts: '2026-05-15T10:01:00Z',
        last_resp_ts: '2026-05-15T10:02:30Z'
      })
    );
    const snap = findStateForSessionId('pi', 'pi-sid-1');
    expect(snap).not.toBeNull();
    expect(snap?.cli).toBe('pi');
    expect(snap?.sessionId).toBe('pi-sid-1');
    expect(snap?.stateLabel).toBe('Working');
    expect(snap?.cwd).toBe('/Users/x/proj');
    expect(snap?.sessionStartedAt).toBe(Date.parse('2026-05-15T10:00:00Z'));
    expect(snap?.timestamps.sentAt).toBe(Date.parse('2026-05-15T10:01:00Z'));
    expect(snap?.timestamps.respAt).toBe(Date.parse('2026-05-15T10:02:30Z'));
  });

  it('session_start-only emit (no turn yet) is valid and readable', () => {
    writeFileSync(
      join(piDir, 'pi-sid-2.json'),
      JSON.stringify({ state: 'Available', session_start: '2026-05-15T09:00:00Z', cwd: '/p' })
    );
    const snap = findStateForSessionId('pi', 'pi-sid-2');
    expect(snap?.stateLabel).toBe('Available');
    expect(snap?.timestamps.sentAt).toBeUndefined();
    expect(snap?.timestamps.respAt).toBeUndefined();
  });

  it('listSnapshots + findStateForCwd resolve pi sessions', () => {
    writeFileSync(
      join(piDir, 'pi-a.json'),
      JSON.stringify({ state: 'Waiting', cwd: '/repo/alpha' })
    );
    expect(listSnapshots('pi')).toHaveLength(1);
    expect(findStateForCwd('pi', '/repo/alpha')?.sessionId).toBe('pi-a');
  });

  // B-HARDEN-sessionid-pk S1 (D-SCHEMA) — optional pid, back-compat.
  it('parses optional pid when the emitter writes it', () => {
    writeFileSync(
      join(piDir, 'pi-pid.json'),
      JSON.stringify({ state: 'Working', cwd: '/p', pid: 48213 })
    );
    expect(findStateForSessionId('pi', 'pi-pid')?.pid).toBe(48213);
  });

  it('pid is undefined when absent (back-compat, no regression)', () => {
    writeFileSync(
      join(piDir, 'pi-nopid.json'),
      JSON.stringify({ state: 'Available', cwd: '/p' })
    );
    expect(findStateForSessionId('pi', 'pi-nopid')?.pid).toBeUndefined();
  });

  it('non-numeric pid is ignored (treated as absent)', () => {
    writeFileSync(
      join(piDir, 'pi-badpid.json'),
      JSON.stringify({ state: 'Working', cwd: '/p', pid: 'nope' })
    );
    expect(findStateForSessionId('pi', 'pi-badpid')?.pid).toBeUndefined();
  });
});
