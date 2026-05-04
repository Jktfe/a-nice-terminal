// ANT v3 — Watchdog: Resource Monitor + Stall Detection
//
// Advisory only — observes, surfaces, never kills.
//
// Polls system resources every POLL_INTERVAL_MS and stores per-session
// CPU/RSS snapshots. Detects stalled sessions (high CPU + no output).
// Enforces an optional active-agent cap on new spawns (soft block, not kill).
//
// All state lives on globalThis so tsx + SvelteKit share one instance.

import { execFileSync } from 'child_process';

const G = globalThis as any;
const KEY = '__ant_watchdog__';

export interface SessionResources {
  sessionId: string;
  pid: number;          // tmux server PID or leader PID
  cpuPct: number;       // %CPU from ps (all child processes summed)
  rssKb: number;        // RSS in KB (all child processes summed)
  sampledAt: number;    // epoch ms
}

export interface SystemHealth {
  totalCpuPct: number;
  totalRssKb: number;
  activeSessionCount: number;
  maxActiveSessions: number;    // 0 = unlimited
  atCap: boolean;
  stalledSessions: string[];    // session IDs with detected stalls
  sessions: SessionResources[];
  sampledAt: number;
}

export interface StallInfo {
  sessionId: string;
  detectedAt: number;
  cpuPct: number;
  silentSinceMs: number;        // how long since last output
}

interface WatchdogState {
  resources: Map<string, SessionResources>;
  stalls: Map<string, StallInfo>;
  lastPoll: number;
  timer: ReturnType<typeof setInterval> | null;
}

const POLL_INTERVAL_MS = 15_000;
const STALL_CPU_THRESHOLD = 80;
const STALL_SILENCE_MS = 60_000;

function getState(): WatchdogState {
  if (!G[KEY]) {
    G[KEY] = {
      resources: new Map<string, SessionResources>(),
      stalls: new Map<string, StallInfo>(),
      lastPoll: 0,
      timer: null,
    };
  }
  return G[KEY];
}

// Parse ANT_MAX_ACTIVE_AGENTS from env. 0 = unlimited.
export function getMaxActiveSessions(): number {
  const raw = process.env.ANT_MAX_ACTIVE_AGENTS;
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Check whether a new session can be spawned.
// Returns { allowed, reason, candidates } where candidates are idle sessions
// that could be stood down to make room.
export function canSpawn(): { allowed: boolean; reason?: string; activeSessions: number; cap: number } {
  const cap = getMaxActiveSessions();
  if (cap === 0) return { allowed: true, activeSessions: getState().resources.size, cap: 0 };

  const active = getState().resources.size;
  if (active < cap) return { allowed: true, activeSessions: active, cap };

  return {
    allowed: false,
    reason: `Active agent cap reached (${active}/${cap}). Stand down an idle session before spawning a new one.`,
    activeSessions: active,
    cap,
  };
}

// Poll system resources for all tmux sessions managed by ANT.
// Uses `ps` to get CPU% and RSS for tmux session leader processes and their children.
function pollResources(getActiveSessions: () => string[]): void {
  const state = getState();
  const now = Date.now();
  state.lastPoll = now;

  const sessionIds = getActiveSessions();
  const newResources = new Map<string, SessionResources>();

  for (const sessionId of sessionIds) {
    try {
      // Get the tmux server PID for this session via tmux display-message
      const pidStr = execFileSync('/opt/homebrew/bin/tmux', [
        'display-message', '-p', '-t', sessionId, '#{pane_pid}',
      ], { stdio: 'pipe', timeout: 2000 }).toString().trim();

      const pid = parseInt(pidStr, 10);
      if (!pid || !Number.isFinite(pid)) continue;

      // Get CPU% and RSS for this process and all its children
      // ps -o %cpu,rss -g <pgid> sums the process group
      const psOutput = execFileSync('/bin/ps', [
        '-o', '%cpu=,rss=', '-p', String(pid),
      ], { stdio: 'pipe', timeout: 2000 }).toString().trim();

      // Also get child processes
      let totalCpu = 0;
      let totalRss = 0;

      // Get all descendant PIDs via pgrep
      let pids = [String(pid)];
      try {
        const childPids = execFileSync('/usr/bin/pgrep', ['-P', String(pid)], {
          stdio: 'pipe', timeout: 2000,
        }).toString().trim().split('\n').filter(Boolean);
        pids = pids.concat(childPids);
      } catch { /* no children — fine */ }

      try {
        const allPsOutput = execFileSync('/bin/ps', [
          '-o', '%cpu=,rss=', '-p', pids.join(','),
        ], { stdio: 'pipe', timeout: 2000 }).toString().trim();

        for (const line of allPsOutput.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            totalCpu += parseFloat(parts[0]) || 0;
            totalRss += parseInt(parts[1], 10) || 0;
          }
        }
      } catch {
        // Fallback to single process
        const parts = psOutput.trim().split(/\s+/);
        if (parts.length >= 2) {
          totalCpu = parseFloat(parts[0]) || 0;
          totalRss = parseInt(parts[1], 10) || 0;
        }
      }

      newResources.set(sessionId, {
        sessionId,
        pid,
        cpuPct: Math.round(totalCpu * 10) / 10,
        rssKb: totalRss,
        sampledAt: now,
      });
    } catch {
      // Session may have died between list and poll — skip silently
    }
  }

  state.resources = newResources;
}

// Check for stalled sessions: high CPU + no terminal output for extended period.
function detectStalls(getLastActivity: (sessionId: string) => number | null): void {
  const state = getState();
  const now = Date.now();
  const newStalls = new Map<string, StallInfo>();

  for (const [sessionId, res] of state.resources) {
    const lastActivity = getLastActivity(sessionId);
    if (lastActivity === null) continue;

    const silentMs = now - lastActivity;

    if (res.cpuPct >= STALL_CPU_THRESHOLD && silentMs >= STALL_SILENCE_MS) {
      newStalls.set(sessionId, {
        sessionId,
        detectedAt: state.stalls.get(sessionId)?.detectedAt ?? now,
        cpuPct: res.cpuPct,
        silentSinceMs: silentMs,
      });
    }
  }

  state.stalls = newStalls;
}

// Get current health snapshot (used by API endpoint).
export function getHealth(): SystemHealth {
  const state = getState();
  const sessions = [...state.resources.values()];
  const cap = getMaxActiveSessions();

  return {
    totalCpuPct: Math.round(sessions.reduce((sum, s) => sum + s.cpuPct, 0) * 10) / 10,
    totalRssKb: sessions.reduce((sum, s) => sum + s.rssKb, 0),
    activeSessionCount: sessions.length,
    maxActiveSessions: cap,
    atCap: cap > 0 && sessions.length >= cap,
    stalledSessions: [...state.stalls.keys()],
    sessions,
    sampledAt: state.lastPoll,
  };
}

// Get stall info for a specific session.
export function getStall(sessionId: string): StallInfo | null {
  return getState().stalls.get(sessionId) ?? null;
}

// Start the polling loop. Call once from server.ts.
export function startWatchdog(deps: {
  getActiveSessions: () => string[];
  getLastActivity: (sessionId: string) => number | null;
  broadcastGlobal?: (msg: any) => void;
}): void {
  const state = getState();
  if (state.timer) return; // already running

  function tick() {
    pollResources(deps.getActiveSessions);
    const prevStalls = new Set(state.stalls.keys());
    detectStalls(deps.getLastActivity);

    // Broadcast new stalls
    if (deps.broadcastGlobal) {
      for (const [sessionId, stall] of state.stalls) {
        if (!prevStalls.has(sessionId)) {
          deps.broadcastGlobal({
            type: 'session_stall_detected',
            sessionId,
            cpuPct: stall.cpuPct,
            silentSinceMs: stall.silentSinceMs,
          });
        }
      }
    }
  }

  // Initial poll
  try { tick(); } catch (err) {
    console.error('[watchdog] initial tick failed:', err);
  }
  state.timer = setInterval(() => {
    try { tick(); } catch (err) {
      console.error('[watchdog] tick failed:', err);
    }
  }, POLL_INTERVAL_MS);
  console.log('[watchdog] started — polling every 15s');
}
