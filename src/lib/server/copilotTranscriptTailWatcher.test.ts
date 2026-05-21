import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _internals, _resetCopilotTranscriptTailStateForTests, tailOnceForTerminal
} from './copilotTranscriptTailWatcher';
import { getIdentityDb } from './db';

describe('COPILOT watcher pure helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cop-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('firstLine returns first newline-terminated line', () => {
    const f = join(dir, 'events.jsonl');
    writeFileSync(f, 'line one\nrest\n');
    expect(_internals.firstLine(f)).toBe('line one');
  });

  it('firstLine handles 13KB session.start (chunked read)', () => {
    const f = join(dir, 'big.jsonl');
    const padding = 'X'.repeat(13000);
    const json = JSON.stringify({
      type: 'session.start',
      data: { context: { cwd: '/Users/test/p' }, padding }
    });
    writeFileSync(f, json + '\nnext\n');
    const line = _internals.firstLine(f);
    expect(line).not.toBeNull();
    expect(line!.length).toBeGreaterThan(13000);
    expect(JSON.parse(line!).data.context.cwd).toBe('/Users/test/p');
  });

  it('readAppendedBytes streams', () => {
    const f = join(dir, 'r.jsonl');
    writeFileSync(f, 'first\n');
    expect(_internals.readAppendedBytes(f, 0).text).toBe('first\n');
  });
});

describe('COPILOT tailOnceForTerminal scope guards', () => {
  beforeEach(() => {
    _resetCopilotTranscriptTailStateForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('skips non-copilot agent_kind', () => {
    expect(tailOnceForTerminal({
      session_id: 't_cop_skip', agent_kind: 'claude-code',
      tmux_target_pane: 't_cop_skip:0.0', created_at_ms: Date.now()
    })).toBe(0);
  });

  it('skips when tmux pane missing', () => {
    expect(tailOnceForTerminal({
      session_id: 't_cop_no_pane', agent_kind: 'copilot',
      tmux_target_pane: null, created_at_ms: Date.now()
    })).toBe(0);
  });
});
