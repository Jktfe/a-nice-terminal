import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { queries } from '$lib/server/db';

const execFileAsync = promisify(execFile);

const SESSION_ID_RE = /^[A-Za-z0-9_-]{10,40}$/;

const CONFIG_FILE = join(process.env.HOME || '/tmp', '.ant', 'config.json');

function resolveTerminalApp(): string {
  if (process.env.ANT_TERMINAL_APP) return process.env.ANT_TERMINAL_APP.trim();
  if (existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (typeof cfg.terminal_app === 'string' && cfg.terminal_app.trim()) {
        return cfg.terminal_app.trim();
      }
    } catch {}
  }
  return 'ghostty';
}

function appLabel(app: string): string {
  const labels: Record<string, string> = {
    ghostty: 'Ghostty',
    iterm2: 'iTerm2',
    terminal: 'Terminal',
    warp: 'Warp',
    kitty: 'kitty',
    alacritty: 'Alacritty',
    hyper: 'Hyper',
  };
  return labels[app.toLowerCase()] ?? app;
}

async function launchTerminal(app: string, sessionId: string): Promise<void> {
  const lower = app.toLowerCase();

  if (lower === 'ghostty') {
    const bin = '/Applications/Ghostty.app/Contents/MacOS/ghostty';
    await execFileAsync(bin, [`--command=tmux attach -t ${sessionId}`]);
    return;
  }

  if (lower === 'iterm2') {
    const script = `tell application "iTerm" to create window with default profile command "tmux attach -t ${sessionId}"`;
    await execFileAsync('osascript', ['-e', script]);
    return;
  }

  if (lower === 'terminal') {
    const script = `tell application "Terminal" to do script "tmux attach -t ${sessionId}"`;
    await execFileAsync('osascript', ['-e', script]);
    return;
  }

  if (lower === 'kitty') {
    await execFileAsync('kitty', ['--', 'tmux', 'attach', '-t', sessionId]);
    return;
  }

  if (lower === 'alacritty') {
    await execFileAsync('alacritty', ['-e', 'tmux', 'attach', '-t', sessionId]);
    return;
  }

  if (lower === 'warp') {
    // Warp doesn't support a launch-with-command flag; open the app and let the user attach
    await execFileAsync('open', ['-a', 'Warp']);
    return;
  }

  // Unknown app — not supported rather than silently wrong
  throw new Error(`Unsupported terminal app: ${app}. Set ANT_TERMINAL_APP to ghostty, iterm2, terminal, kitty, or alacritty.`);
}

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  if ((session as any).type !== 'terminal') throw error(400, 'Session is not a terminal');

  const app = resolveTerminalApp();
  return json({ app, label: appLabel(app) });
}

export async function POST({ params }: RequestEvent<{ id: string }>) {
  const { id } = params;

  if (!SESSION_ID_RE.test(id)) throw error(400, 'Invalid session id');

  const session = queries.getSession(id);
  if (!session) throw error(404, 'Session not found');
  if ((session as any).type !== 'terminal') throw error(400, 'Session is not a terminal');

  const app = resolveTerminalApp();

  try {
    await launchTerminal(app, id);
    return json({ ok: true, app, label: appLabel(app) });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('Unsupported terminal app')) throw error(501, msg);
    throw error(500, `Failed to launch ${appLabel(app)}: ${msg}`);
  }
}
