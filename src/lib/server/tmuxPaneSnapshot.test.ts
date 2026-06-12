/**
 * RAW-CAPTURE-PANE-ON-CONNECT (v3-LIFT) — verifies the tmux capture
 * command shape matches v3's reconnect pattern. We can't spawn a real
 * tmux pane in unit tests, so we mock spawnSync and assert the exact
 * argv (the -J join flag is the load-bearing fix) + CRLF normalisation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spawnCalls: { bin: string; args: string[] }[] = [];
let mockStdout = '';
let mockStatus = 0;

vi.mock('node:child_process', () => ({
  spawnSync: (bin: string, args: string[]) => {
    spawnCalls.push({ bin, args });
    return { status: mockStatus, stdout: mockStdout };
  }
}));

vi.mock('./terminalRecordsStore', () => ({
  getTerminalRecord: (sid: string) =>
    sid === 't_has_pane' ? { tmux_target_pane: 'custom:1.2' } : null
}));

const { capturePaneScrollback, tmuxTargetForSession } = await import('./tmuxPaneSnapshot');
const { TMUX_BIN } = await import('./tmuxBin');

beforeEach(() => { spawnCalls.length = 0; mockStdout = ''; mockStatus = 0; });

function captureArgs(): string[] {
  const c = spawnCalls.find((s) => s.args[0] === 'capture-pane');
  return c ? c.args : [];
}
afterEach(() => { vi.clearAllMocks(); });

describe('tmuxTargetForSession', () => {
  it('uses the record tmux_target_pane when present', () => {
    expect(tmuxTargetForSession('t_has_pane')).toBe('custom:1.2');
  });
  it('falls back to <sessionId>:0.0 when no record', () => {
    expect(tmuxTargetForSession('t_none')).toBe('t_none:0.0');
  });
});

describe('capturePaneScrollback — current-screen seed (delta-2)', () => {
  it('on-connect seed (no startLine arg): NO -S → captures current rendered screen', () => {
    mockStdout = 'TUI render\n';
    capturePaneScrollback('mypane:0.0');
    expect(captureArgs()).toEqual([
      'capture-pane', '-p', '-e', '-J', '-t', 'mypane:0.0'
    ]);
    expect(captureArgs()).not.toContain('-S');
  });

  it('explicit startLine opts into -S scrollback (line-mode shell history)', () => {
    capturePaneScrollback('p', -1000);
    expect(captureArgs()).toEqual([
      'capture-pane', '-p', '-e', '-J', '-t', 'p', '-S', '-1000'
    ]);
  });

  it('-J join flag always present (box-drawing reconstruction)', () => {
    capturePaneScrollback('p');
    expect(captureArgs()).toContain('-J');
  });

  it('-e escape flag always present (xterm SGR re-render)', () => {
    capturePaneScrollback('p');
    expect(captureArgs()).toContain('-e');
  });

  it('normalises LF + bare CRLF to CRLF for xterm seeding', () => {
    mockStdout = 'a\nb\r\nc\n';
    expect(capturePaneScrollback('p')).toBe('a\r\nb\r\nc\r\n');
  });

  it('returns empty string on non-zero tmux capture exit (pane gone)', () => {
    mockStatus = 1;
    mockStdout = 'should be ignored';
    expect(capturePaneScrollback('p')).toBe('');
  });
});

describe('tmux binary resolution (rv1/tmux-unify)', () => {
  it('spawns the canonical TMUX_BIN from tmuxBin — no per-module ?? fallback', () => {
    capturePaneScrollback('p');
    expect(spawnCalls.length).toBeGreaterThan(0);
    expect(spawnCalls[0].bin).toBe(TMUX_BIN);
  });
});
