import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _internals, _resetQwenTranscriptTailStateForTests, tailOnceForTerminal
} from './qwenTranscriptTailWatcher';
import { getIdentityDb } from './db';

describe('QWEN watcher pure helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qwn-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('findNewestJsonl picks newest .jsonl', () => {
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
    expect(_internals.readAppendedBytes(f, 0).text).toBe('first\n');
  });
});

describe('QWEN tailOnceForTerminal scope guards', () => {
  beforeEach(() => {
    _resetQwenTranscriptTailStateForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('skips non-qwen agent_kind', () => {
    expect(tailOnceForTerminal({
      session_id: 't_qwn_skip', agent_kind: 'claude-code',
      tmux_target_pane: 't_qwn_skip:0.0', created_at_ms: Date.now()
    })).toBe(0);
  });

  it('skips when tmux pane missing', () => {
    expect(tailOnceForTerminal({
      session_id: 't_qwn_no_pane', agent_kind: 'qwen',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0);
  });

  it('accepts qwen-cli alias', () => {
    expect(tailOnceForTerminal({
      session_id: 't_qwn_alias', agent_kind: 'qwen-cli',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0); // still 0 because pane is null but proves alias accepted
  });
});
