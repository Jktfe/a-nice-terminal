import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _internals, _resetPiTranscriptTailStateForTests,
  tailOnceForTerminal, encodedCwdSegmentForPi
} from './piTranscriptTailWatcher';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('encodedCwdSegmentForPi', () => {
  it('wraps cwd in -- prefix/suffix and replaces / with -', () => {
    expect(encodedCwdSegmentForPi('/Users/you/CascadeProjects/a-nice-terminal'))
      .toBe('--Users-you-CascadeProjects-a-nice-terminal--');
  });
});

describe('PI watcher pure helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pi-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('findNewestJsonl picks newest .jsonl with mtime > since', () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeFileSync(a, 'a\n');
    writeFileSync(b, 'b\n');
    const n = Date.now() / 1000;
    utimesSync(a, n - 60, n - 60);
    utimesSync(b, n, n);
    expect(_internals.findNewestJsonl(dir, 0)).toBe(b);
  });

  it('readAppendedBytes streams', () => {
    const f = join(dir, 'r.jsonl');
    writeFileSync(f, 'first\n');
    const r1 = _internals.readAppendedBytes(f, 0);
    expect(r1.text).toBe('first\n');
  });
});

describe('PI tailOnceForTerminal scope guards', () => {
  beforeEach(() => {
    _resetPiTranscriptTailStateForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('skips non-pi agent_kind', () => {
    expect(tailOnceForTerminal({
      session_id: 't_pi_skip', agent_kind: 'claude-code',
      tmux_target_pane: 't_pi_skip:0.0', created_at_ms: Date.now()
    })).toBe(0);
  });

  it('skips when tmux pane missing', () => {
    expect(tailOnceForTerminal({
      session_id: 't_pi_no_pane', agent_kind: 'pi',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0);
  });
});
