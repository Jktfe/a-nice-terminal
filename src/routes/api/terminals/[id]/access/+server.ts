import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';

export const GET: RequestHandler = async ({ params }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required');
  const record = getTerminalRecord(terminalId);
  if (!record) throw error(404, 'terminal not found');
  const tmuxSession = tmuxSessionFromPane(record.tmux_target_pane) || terminalId;
  const localTmux = `tmux attach-session -t ${shellQuote(tmuxSession)}`;
  // ANT_SSH_HOST default is intentionally empty for OSS — operators set
  // it via env or ~/.ant/secrets.env. Pre-launch security scrub item D
  // (audits/2026-05-19-pre-launch-security-scrub.md) — no Tailscale
  // hostname literals in production code. If unset, the sshTmux command
  // surfaces a placeholder the operator can edit, not someone else's host.
  const host = process.env.ANT_SSH_HOST || '<set ANT_SSH_HOST env>';
  const sshTmux = `ssh ${shellQuote(host)} -t ${localTmux}`;
  const preferredEmulator = process.env.ANT_TERMINAL_EMULATOR || 'iTerm2';

  return json({
    terminalId,
    tmuxSession,
    tmuxTargetPane: record.tmux_target_pane,
    preferredEmulator,
    commands: {
      localTmux,
      sshTmux,
      iterm2: `osascript -e ${shellQuote(`tell application "iTerm2" to create window with default profile command ${JSON.stringify(localTmux)}`)}`,
      ghostty: `open -a Ghostty --args -e ${localTmux}`,
      terminalApp: `osascript -e ${shellQuote(`tell application "Terminal" to do script ${JSON.stringify(localTmux)}`)}`,
      warp: `open -a Warp --args -e ${localTmux}`
    }
  });
};

function tmuxSessionFromPane(targetPane: string | null): string | null {
  if (!targetPane) return null;
  const [session] = targetPane.split(':');
  return session || targetPane;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
