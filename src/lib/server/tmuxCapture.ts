// tmuxCapture — shared CaptureFn type + defaultTmuxCaptureFn lifted from
// agentStatusPoller.ts so fingerprintDetector.ts can import it without
// creating a circular dep with the poller (M3.2c B1 precondition).
import { spawnSync } from 'node:child_process';
import { type TerminalRow } from './terminalsStore';

export type CaptureFn = (terminal: TerminalRow) => string | null;

const TMUX_CAPTURE_TIMEOUT_MS = 250;

export const defaultTmuxCaptureFn: CaptureFn = (terminal) => {
  const pane = terminal.tmux_target_pane;
  if (pane === null || pane.length === 0) return null;
  try {
    const result = spawnSync('tmux', ['capture-pane', '-t', pane, '-p', '-S', '-10'],
      { encoding: 'utf8', timeout: TMUX_CAPTURE_TIMEOUT_MS });
    if (result.status !== 0) return null;
    return result.stdout ?? null;
  } catch {
    return null;
  }
};
