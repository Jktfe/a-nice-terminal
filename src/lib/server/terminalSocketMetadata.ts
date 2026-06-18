import { spawnSync } from 'node:child_process';
import { TMUX_BIN } from './tmuxBin';

export type TerminalSocketBinding = {
  tmuxSocketPath: string;
  tmuxSessionName: string;
  tmuxTargetPane: string | null;
  paneTitle: string | null;
};

export type TerminalSocketProbe = {
  pid: number;
  pidStart: string | null;
  tmuxSessionName: string;
  tmuxTargetPane: string;
  paneTitle: string | null;
};

type SpawnResult = {
  status: number | null;
  stdout: Buffer | string;
};

type SpawnRunner = (command: string, args: string[], options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore'] }) => SpawnResult;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMeta(rawMeta: string | null | undefined): Record<string, unknown> | null {
  if (!rawMeta) return null;
  try {
    const parsed = JSON.parse(rawMeta);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function terminalSocketBindingFromMeta(rawMeta: string | null | undefined): TerminalSocketBinding | null {
  const meta = parseMeta(rawMeta);
  if (!meta) return null;
  const tmuxSocketPath = cleanText(meta.tmuxSocketPath);
  const tmuxSessionName = cleanText(meta.tmuxSessionName);
  if (!tmuxSocketPath || !tmuxSessionName) return null;
  return {
    tmuxSocketPath,
    tmuxSessionName,
    tmuxTargetPane: cleanText(meta.tmuxTargetPane),
    paneTitle: cleanText(meta.paneTitle)
  };
}

export function socketBackedTerminalAlive(
  rawMeta: string | null | undefined,
  fallbackTargetPane: string | null | undefined,
  run: SpawnRunner = spawnSync as SpawnRunner
): boolean {
  const binding = terminalSocketBindingFromMeta(rawMeta);
  if (!binding) return false;
  const target = binding.tmuxTargetPane ?? cleanText(fallbackTargetPane) ?? binding.tmuxSessionName;
  const result = run(TMUX_BIN, [
    '-S',
    binding.tmuxSocketPath,
    'display-message',
    '-p',
    '-t',
    target,
    '#{session_name}'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0;
}

export function probeTmuxSocketBinding(input: {
  tmuxSocketPath: string;
  tmuxSessionName: string;
  tmuxTargetPane?: string | null;
}, run: SpawnRunner = spawnSync as SpawnRunner): TerminalSocketProbe | null {
  const tmuxSocketPath = cleanText(input.tmuxSocketPath);
  const tmuxSessionName = cleanText(input.tmuxSessionName);
  if (!tmuxSocketPath || !tmuxSocketPath.startsWith('/') || !tmuxSessionName) return null;
  const target = cleanText(input.tmuxTargetPane) ?? tmuxSessionName;
  const result = run(TMUX_BIN, [
    '-S',
    tmuxSocketPath,
    'display-message',
    '-p',
    '-t',
    target,
    '#{pane_pid}|#{pane_id}|#{session_name}|#{pane_title}'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return null;
  const raw = String(result.stdout ?? '').trim();
  const parts = raw.split('|');
  if (parts.length < 3) return null;
  const pid = Number(parts[0]);
  const tmuxTargetPane = cleanText(parts[1]);
  const actualSessionName = cleanText(parts[2]);
  if (!Number.isFinite(pid) || pid <= 0 || !tmuxTargetPane || !actualSessionName) return null;
  const pidStartResult = run('ps', [
    '-o',
    'lstart=',
    '-p',
    String(Math.floor(pid))
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return {
    pid: Math.floor(pid),
    pidStart: pidStartResult.status === 0 ? cleanText(pidStartResult.stdout) : null,
    tmuxSessionName: actualSessionName,
    tmuxTargetPane,
    paneTitle: cleanText(parts.slice(3).join('|'))
  };
}
