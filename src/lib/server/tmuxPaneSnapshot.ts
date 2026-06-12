import { spawnSync } from 'node:child_process';
import { getTerminalRecord } from './terminalRecordsStore';
import { TMUX_BIN } from './tmuxBin';

function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.TMUX_PLUGIN_MANAGER_PATH;
  return env as NodeJS.ProcessEnv;
}

export function tmuxTargetForSession(sessionId: string): string {
  return getTerminalRecord(sessionId)?.tmux_target_pane || `${sessionId}:0.0`;
}

export function tmuxPaneCurrentPath(target: string): string | null {
  const result = spawnSync(
    TMUX_BIN,
    ['display-message', '-p', '-t', target, '#{pane_current_path}'],
    { encoding: 'utf8', timeout: 2_000, env: scrubbedEnv() }
  );
  if (result.status !== 0) return null;
  const cwd = (result.stdout ?? '').trim();
  return cwd.length > 0 ? cwd : null;
}

// RAW-CAPTURE-PANE-ON-CONNECT delta-2 (2026-05-15). v1 used a fixed
// `-S -1000`. claude2's SSE-frame-byte trace proved that window targets
// the NORMAL-buffer scrollback, which is blank for a full-screen TUI
// (claude-code), so the seed frame was all whitespace and the RAW view
// rendered empty on idle-open. (`#{alternate_on}` is even 0 for
// claude-code — it redraws the normal buffer rather than switching to
// the alternate one — so an alt-screen branch would NOT have fixed it.)
//
// Coordinator-directed simplest-correct fix: drop `-S` entirely for the
// on-connect seed. `tmux capture-pane -p -e -J -t <pane>` captures
// whatever screen is CURRENTLY rendered — alt OR normal-redraw — i.e.
// exactly "what you'd see if you attached right now". That is the right
// seed for both a live TUI and an idle shell.
//   -p print, -e keep SGR escapes for xterm, -J join wrapped lines.
// Emitted as the first SSE frame before the live byte-tail (caller).
// `startLine` is retained for callers that explicitly want scrollback
// (line-mode shell history); pass a negative number to opt in.
export function capturePaneScrollback(target: string, startLine?: number): string {
  const args = ['capture-pane', '-p', '-e', '-J', '-t', target];
  if (typeof startLine === 'number') args.push('-S', String(startLine));
  const result = spawnSync(TMUX_BIN, args, {
    encoding: 'utf8', timeout: 2_000, env: scrubbedEnv()
  });
  if (result.status !== 0) return '';
  // xterm expects CRLF for line breaks when seeding from captured rows.
  return (result.stdout ?? '').replace(/\r?\n/g, '\r\n');
}
