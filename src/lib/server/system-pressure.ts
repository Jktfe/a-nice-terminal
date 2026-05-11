// C3 of main-app-improvements-2026-05-10 — server-side helper for the
// /api/diagnostics/system-pressure endpoint. Captures process count,
// agent process count, RAM total/used/swap, tmux session count, and
// ant.db size. Goal is signal across causes (ANT vs other workloads
// like video processing) so saturation is visible BEFORE the operator
// asks "why is it slow".
//
// Everything here is best-effort: any individual probe failing returns
// null for its slot rather than failing the whole response. The
// endpoint is informational, not a control surface.

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { statSync } from 'fs';
import { totalmem, freemem, loadavg } from 'os';
import { getAntDbPath } from './db.js';

const runExecFile = promisify(execFileCb);

const PS_AGENT_PATTERN = /claude|codex|gemini|qwen|copilot|aider|pi-cli|crush/i;

export interface SystemPressureSnapshot {
  generated_at_ms: number;
  platform: string;
  uptime_s: number;
  load_avg: { '1m': number; '5m': number; '15m': number };
  ram: {
    total_bytes: number;
    free_bytes: number;
    used_bytes: number;
    used_pct: number;
  };
  node_rss_bytes: number;
  processes: {
    total: number | null;
    agents: number | null;
  };
  tmux_sessions: number | null;
  ant_db: {
    path: string;
    size_bytes: number | null;
  };
}

async function safeRun(file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await runExecFile(file, args, { timeout: 1500 });
    return stdout;
  } catch {
    return null;
  }
}

async function countProcesses(): Promise<{ total: number | null; agents: number | null }> {
  const stdout = await safeRun('ps', ['-axco', 'command']);
  if (!stdout) return { total: null, agents: null };
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^command$/i.test(line));
  const total = lines.length;
  const agents = lines.filter((line) => PS_AGENT_PATTERN.test(line)).length;
  return { total, agents };
}

async function countTmuxSessions(): Promise<number | null> {
  const socket = process.env.ANT_TMUX_SOCKET;
  const args = socket ? ['-L', socket, 'ls'] : ['ls'];
  const stdout = await safeRun('tmux', args);
  if (stdout === null) return 0; // tmux not running == zero sessions
  return stdout.split('\n').filter((line) => line.trim().length > 0).length;
}

function antDbSize(): { path: string; size_bytes: number | null } {
  const path = getAntDbPath();
  try {
    return { path, size_bytes: statSync(path).size };
  } catch {
    return { path, size_bytes: null };
  }
}

export async function captureSystemPressure(): Promise<SystemPressureSnapshot> {
  const total = totalmem();
  const free = freemem();
  const used = total - free;
  const [oneMin, fiveMin, fifteenMin] = loadavg();
  const [processes, tmuxSessions] = await Promise.all([countProcesses(), countTmuxSessions()]);
  const rss = process.memoryUsage().rss;
  return {
    generated_at_ms: Date.now(),
    platform: process.platform,
    uptime_s: Math.round(process.uptime()),
    load_avg: { '1m': oneMin, '5m': fiveMin, '15m': fifteenMin },
    ram: {
      total_bytes: total,
      free_bytes: free,
      used_bytes: used,
      used_pct: total > 0 ? +(((used / total) * 100).toFixed(1)) : 0,
    },
    node_rss_bytes: rss,
    processes,
    tmux_sessions: tmuxSessions,
    ant_db: antDbSize(),
  };
}
