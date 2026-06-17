import { describe, expect, it, vi } from 'vitest';
import {
  probeTmuxSocketBinding,
  socketBackedTerminalAlive,
  terminalSocketBindingFromMeta
} from './terminalSocketMetadata';
import { TMUX_BIN } from './tmuxBin';

describe('terminalSocketMetadata', () => {
  it('parses socket locator metadata from terminals.meta', () => {
    const binding = terminalSocketBindingFromMeta(JSON.stringify({
      tmuxSocketPath: '/Users/james/.tmux-antos/default',
      tmuxSessionName: 'antos-term 2',
      tmuxTargetPane: '%10',
      paneTitle: 'anTERM'
    }));
    expect(binding).toEqual({
      tmuxSocketPath: '/Users/james/.tmux-antos/default',
      tmuxSessionName: 'antos-term 2',
      tmuxTargetPane: '%10',
      paneTitle: 'anTERM'
    });
  });

  it('checks socket-backed liveness against the private tmux socket', () => {
    const run = vi.fn(() => ({ status: 0, stdout: 'antos-term 2\n' }));
    const alive = socketBackedTerminalAlive(JSON.stringify({
      tmuxSocketPath: '/tmp/private/default',
      tmuxSessionName: 'antos-term 2',
      tmuxTargetPane: '%10'
    }), null, run);

    expect(alive).toBe(true);
    expect(run).toHaveBeenCalledWith(TMUX_BIN, [
      '-S',
      '/tmp/private/default',
      'display-message',
      '-p',
      '-t',
      '%10',
      '#{session_name}'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  });

  it('probes pid, pane id, actual session name, title, and pid start without a shell', () => {
    const run = vi.fn((command: string) => {
      if (command === TMUX_BIN) return { status: 0, stdout: '57134|%10|antos-term 2|anTERM\n' };
      return { status: 0, stdout: 'Tue Jun 16 10:14:11 2026\n' };
    });

    const probe = probeTmuxSocketBinding({
      tmuxSocketPath: '/tmp/private/default',
      tmuxSessionName: 'antos-term 2'
    }, run);

    expect(probe).toEqual({
      pid: 57134,
      pidStart: 'Tue Jun 16 10:14:11 2026',
      tmuxSessionName: 'antos-term 2',
      tmuxTargetPane: '%10',
      paneTitle: 'anTERM'
    });
    expect(run).toHaveBeenNthCalledWith(1, TMUX_BIN, [
      '-S',
      '/tmp/private/default',
      'display-message',
      '-p',
      '-t',
      'antos-term 2',
      '#{pane_pid}|#{pane_id}|#{session_name}|#{pane_title}'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(run).toHaveBeenNthCalledWith(2, 'ps', [
      '-o',
      'lstart=',
      '-p',
      '57134'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  });
});
