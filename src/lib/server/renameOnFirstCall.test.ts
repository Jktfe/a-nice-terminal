import { describe, expect, it } from 'vitest';
import {
  maybeInjectRenameOnFirstCall,
  renameCommandFor,
  type RenameInjectDeps
} from './renameOnFirstCall';
import type { TerminalRow } from './terminalsStore';

function depsWith(overrides: Partial<RenameInjectDeps> & { submitted?: string[] }): RenameInjectDeps & { submitted: string[] } {
  const submitted: string[] = overrides.submitted ?? [];
  return {
    submitted,
    getTerminal:
      overrides.getTerminal ??
      (() => ({ id: 't_1', tmux_target_pane: 'ant:0.0', agent_kind: 'claude_code' }) as TerminalRow),
    verifyPane: overrides.verifyPane ?? (() => 'verified'),
    submit: overrides.submit ?? ((_pane, text) => void submitted.push(text))
  };
}

describe('renameCommandFor', () => {
  it('builds /rename from the base terminal name', () => {
    expect(renameCommandFor('speedyClaude')).toBe('/rename speedyClaude');
  });

  it('refuses auto-generated names', () => {
    expect(renameCommandFor('auto:t_mfof4ylmuz')).toBeNull();
  });

  it('flattens newlines/tabs and caps length (typed into a live prompt)', () => {
    expect(renameCommandFor('multi\nline\tname')).toBe('/rename multi line name');
    const long = 'x'.repeat(200);
    expect(renameCommandFor(long)!.length).toBeLessThanOrEqual('/rename '.length + 80);
  });

  it('refuses empty/whitespace names', () => {
    expect(renameCommandFor('   ')).toBeNull();
  });
});

describe('maybeInjectRenameOnFirstCall', () => {
  it('injects /rename into a verified pane', () => {
    const deps = depsWith({});
    expect(maybeInjectRenameOnFirstCall('t_1', 'speedyClaude', deps)).toBe('injected');
    expect(deps.submitted).toEqual(['/rename speedyClaude']);
  });

  it('skips auto names without touching the pane', () => {
    const deps = depsWith({});
    expect(maybeInjectRenameOnFirstCall('t_1', 'auto:t_1', deps)).toBe('skipped-auto-name');
    expect(deps.submitted).toEqual([]);
  });

  it('skips when the terminal has no pane', () => {
    const deps = depsWith({ getTerminal: () => ({ id: 't_1', tmux_target_pane: null }) as TerminalRow });
    expect(maybeInjectRenameOnFirstCall('t_1', 'name', deps)).toBe('skipped-no-pane');
  });

  it('skips when the pane is not prompt-ready (slow TUI boot retries next launch)', () => {
    const deps = depsWith({ verifyPane: () => 'unknown' });
    expect(maybeInjectRenameOnFirstCall('t_1', 'name', deps)).toBe('skipped-not-ready');
    expect(deps.submitted).toEqual([]);
  });

  it('swallows submit failures as a silent skip (best-effort capture stance)', () => {
    const deps = depsWith({
      submit: () => {
        throw new Error('tmux gone');
      }
    });
    expect(maybeInjectRenameOnFirstCall('t_1', 'name', deps)).toBe('skipped-inject-failed');
  });
});
