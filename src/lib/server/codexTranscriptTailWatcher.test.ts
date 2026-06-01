/**
 * TRANSCRIPT-TAIL-CODEX-v2 watcher tests. Focuses on pure helpers
 * (listCandidateRollouts, firstLine, findRolloutForCwd, readAppendedBytes)
 * and scope guards. Live tmux lookups are env-dependent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _internals, _resetCodexTranscriptTailStateForTests,
  tailOnceForTerminal
} from './codexTranscriptTailWatcher';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('TRANSCRIPT-TAIL-CODEX-v2 — pure helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctail-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('firstLine returns the first newline-terminated line of a file', () => {
    const f = join(dir, 't.jsonl');
    writeFileSync(f, 'line one\nline two\nline three\n');
    expect(_internals.firstLine(f)).toBe('line one');
  });

  it('firstLine returns null when no newline in file (bounded read)', () => {
    const f = join(dir, 'one.jsonl');
    writeFileSync(f, 'no newline here');
    expect(_internals.firstLine(f)).toBeNull();
  });

  it('firstLine returns null for missing file', () => {
    expect(_internals.firstLine(join(dir, 'missing.jsonl'))).toBeNull();
  });

  // CODEX-v2 delta regression (2026-05-15): real rollout session_meta
  // lines are ~13KB. Earlier 8KB cap silently truncated → cwd extraction
  // failed → watcher attribution broke. Test locks the chunked-read fix.
  it('firstLine reads a 13KB session_meta line containing cwd', () => {
    const f = join(dir, 'big.jsonl');
    const padding = 'X'.repeat(13000); // 13KB padding within session_meta
    const json = JSON.stringify({
      type: 'session_meta',
      payload: { id: 'abc', cwd: '/Users/test/project', padding }
    });
    writeFileSync(f, json + '\nnext line\n');
    const line = _internals.firstLine(f);
    expect(line).not.toBeNull();
    expect(line!.length).toBeGreaterThan(13000);
    // Round-trips as JSON with cwd intact.
    const parsed = JSON.parse(line!);
    expect(parsed.payload.cwd).toBe('/Users/test/project');
  });

  it('firstLine handles >64KB lines up to the 128KB ceiling', () => {
    const f = join(dir, 'huge.jsonl');
    const padding = 'Y'.repeat(80_000); // 80KB padding
    const json = JSON.stringify({
      type: 'session_meta',
      payload: { id: 'x', cwd: '/big', padding }
    });
    writeFileSync(f, json + '\n');
    const line = _internals.firstLine(f);
    expect(line).not.toBeNull();
    const parsed = JSON.parse(line!);
    expect(parsed.payload.cwd).toBe('/big');
  });

  it('readAppendedBytes streams across appends', () => {
    const f = join(dir, 'append.jsonl');
    writeFileSync(f, 'first\n');
    const r1 = _internals.readAppendedBytes(f, 0);
    expect(r1.text).toBe('first\n');
    appendFileSync(f, 'second\n');
    const r2 = _internals.readAppendedBytes(f, r1.newOffset);
    expect(r2.text).toBe('second\n');
  });
});

describe('TRANSCRIPT-TAIL-CODEX-v2 — tailOnceForTerminal scope guards', () => {
  beforeEach(() => {
    _resetCodexTranscriptTailStateForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('returns 0 for non-codex agent_kind', () => {
    expect(tailOnceForTerminal({
      session_id: 't_skip_c', agent_kind: 'claude-code',
      tmux_target_pane: 't_skip_c:0.0', created_at_ms: Date.now()
    })).toBe(0);
    expect(listLatestTerminalRunEvents('t_skip_c', 5)).toHaveLength(0);
  });

  it('returns 0 when tmux pane missing', () => {
    expect(tailOnceForTerminal({
      session_id: 't_no_pane_c', agent_kind: 'codex',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0);
  });

  it('returns 0 for codex-cli alias when pane missing', () => {
    expect(tailOnceForTerminal({
      session_id: 't_codex_alias', agent_kind: 'codex-cli',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0);
  });
});
