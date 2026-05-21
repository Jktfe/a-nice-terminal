import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _internals, _resetGeminiTranscriptTailStateForTests, tailOnceForTerminal
} from './geminiTranscriptTailWatcher';
import { getIdentityDb } from './db';

describe('GEMINI watcher pure helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gem-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('findNewestSessionJsonl picks newest session-*.jsonl', () => {
    const a = join(dir, 'session-a.jsonl');
    const b = join(dir, 'session-b.jsonl');
    const x = join(dir, 'other.jsonl');
    writeFileSync(a, 'a\n');
    writeFileSync(b, 'b\n');
    writeFileSync(x, 'x\n');
    const n = Date.now() / 1000;
    utimesSync(a, n - 60, n - 60);
    utimesSync(b, n, n);
    utimesSync(x, n + 60, n + 60); // newest but wrong prefix
    expect(_internals.findNewestSessionJsonl(dir, 0)).toBe(b);
  });

  it('readAppendedBytes streams', () => {
    const f = join(dir, 'session-r.jsonl');
    writeFileSync(f, 'first\n');
    expect(_internals.readAppendedBytes(f, 0).text).toBe('first\n');
  });
});

describe('GEMINI tailOnceForTerminal scope guards', () => {
  beforeEach(() => {
    _resetGeminiTranscriptTailStateForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('skips non-gemini agent_kind', () => {
    expect(tailOnceForTerminal({
      session_id: 't_gem_skip', agent_kind: 'claude-code',
      tmux_target_pane: 't_gem_skip:0.0', created_at_ms: Date.now()
    })).toBe(0);
  });

  it('skips when tmux pane missing', () => {
    expect(tailOnceForTerminal({
      session_id: 't_gem_no_pane', agent_kind: 'gemini',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0);
  });
});
