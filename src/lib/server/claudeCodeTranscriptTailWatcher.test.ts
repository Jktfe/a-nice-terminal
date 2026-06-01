/**
 * TRANSCRIPT-TAIL-CLAUDE-v2 watcher tests. Live tmux/projects-dir lookups
 * are env-dependent so we focus on PURE behaviour: findNewestJsonl +
 * readAppendedBytes + tailOnceForTerminal with a temp jsonl fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, appendFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _internals, _resetTranscriptTailStateForTests,
  tailOnceForTerminal
} from './claudeCodeTranscriptTailWatcher';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('TRANSCRIPT-TAIL-CLAUDE-v2 — pure helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ttail-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('findNewestJsonl returns null when dir empty', () => {
    expect(_internals.findNewestJsonl(dir, 0)).toBeNull();
  });

  it('findNewestJsonl returns null when only old files (mtime ≤ since)', () => {
    const f = join(dir, 'a.jsonl');
    writeFileSync(f, 'x\n');
    const past = Date.now() - 60_000;
    utimesSync(f, past / 1000, past / 1000);
    expect(_internals.findNewestJsonl(dir, Date.now() - 1_000)).toBeNull();
  });

  it('findNewestJsonl picks the newest .jsonl', () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeFileSync(a, 'a\n');
    writeFileSync(b, 'b\n');
    const newer = Date.now() / 1000;
    const older = newer - 60;
    utimesSync(a, older, older);
    utimesSync(b, newer, newer);
    const picked = _internals.findNewestJsonl(dir, 0);
    expect(picked).toBe(b);
  });

  it('readAppendedBytes returns appended content + new offset', () => {
    const f = join(dir, 'r.jsonl');
    writeFileSync(f, 'first\n');
    const r1 = _internals.readAppendedBytes(f, 0);
    expect(r1.text).toBe('first\n');
    appendFileSync(f, 'second\n');
    const r2 = _internals.readAppendedBytes(f, r1.newOffset);
    expect(r2.text).toBe('second\n');
    expect(r2.newOffset).toBeGreaterThan(r1.newOffset);
  });

  it('readAppendedBytes is no-op when file unchanged', () => {
    const f = join(dir, 'n.jsonl');
    writeFileSync(f, 'only\n');
    const offset = statSync(f).size;
    const r = _internals.readAppendedBytes(f, offset);
    expect(r.text).toBe('');
    expect(r.newOffset).toBe(offset);
  });
});

describe('TRANSCRIPT-TAIL-CLAUDE-v2 — tailOnceForTerminal scope guards', () => {
  beforeEach(() => {
    _resetTranscriptTailStateForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('returns 0 for non-claude agent_kind (gate)', () => {
    const r = tailOnceForTerminal({
      session_id: 't_skip', agent_kind: 'codex',
      tmux_target_pane: 't_skip:0.0', created_at_ms: Date.now()
    });
    expect(r).toBe(0);
    expect(listLatestTerminalRunEvents('t_skip', 5)).toHaveLength(0);
  });

  it('returns 0 when tmux pane missing', () => {
    const r = tailOnceForTerminal({
      session_id: 't_no_pane', agent_kind: 'claude-code',
      tmux_target_pane: null, created_at_ms: Date.now()
    });
    expect(r).toBe(0);
  });
});
