// ANT v3 — Session Lifecycle Manager
//
// TTL governs two things only:
//  1. Whether to respawn a session after a daemon restart (was it recent enough to bother?)
//  2. The soft-delete recovery window (how long before a deleted session is gone for good)
//
// A LIVE running PTY is NEVER killed based on idle time.
// The only automatic kills are: hard-expiring soft-deleted sessions past their TTL window.

import { queries, ttlMs } from './db.js';

type PTYClient = {
  spawn: (id: string, cwd: string) => Promise<{ alive: boolean; scrollback: string }>;
  kill: (id: string) => void;
};

// Parse duration strings like '15m', '2h', '7d' into milliseconds.
function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([smhd])$/);
  if (!match) return ttlMs(s); // fall back to the existing lookup table
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default:  return ttlMs(s);
  }
}

// Called once when the server starts and connects to the daemon.
//
// Normal case (web server restarted, daemon still running):
//   The daemon's PTYs are already alive. `pty.spawn()` just reconnects and
//   returns the scrollback buffer — nothing is started.
//
// Rare case (full system reboot, daemon also restarted):
//   PTYs are gone. `pty.spawn()` creates a new tmux session — but ONLY for
//   sessions whose TTL/AON/kill_timer says they should still exist.
export async function rehydrateSessions(pty: PTYClient): Promise<void> {
  // Determine how long the server was down so kill_timer logic can use it.
  const lastStarted = queries.getServerState?.('last_started');
  const prevShutdown = lastStarted ? new Date(lastStarted).getTime() : 0;
  const now = Date.now();
  const downtimeMs = now - prevShutdown;

  const sessions = queries.listTerminalSessions();
  let connected = 0;
  let skipped = 0;

  for (const session of sessions) {
    // Soft-deleted sessions: keep PTY running (for recovery) but don't reconnect
    // to them — they're hidden from the user until restored or expired.
    if (session.deleted_at) {
      const deletedAt = new Date(session.deleted_at).getTime();
      const withinWindow = session.ttl === 'forever' || (now - deletedAt) < ttlMs(session.ttl);
      if (!withinWindow) {
        queries.hardDeleteSession(session.id);
        skipped++;
      }
      continue;
    }

    // AON or within TTL/kill_timer window → connect (or reconnect) to the daemon
    if (shouldConnectAfterRestart(session, downtimeMs, now)) {
      try {
        const cwd = session.root_dir || process.env.HOME || '/tmp';
        await pty.spawn(session.id, cwd);
        connected++;
      } catch (e) {
        console.warn(`[lifecycle] failed to connect to ${session.id}:`, e);
      }
    } else {
      skipped++;
    }
  }

  console.log(`[lifecycle] connected to ${connected} sessions, ${skipped} expired/skipped`);
}

// Should this session be connected after a restart?
// AON: always. kill_timer: only if downtime < timer. Others: TTL from last_activity.
// This is purely a restart-time decision — live sessions are NEVER killed by this.
function shouldConnectAfterRestart(session: any, downtimeMs: number, now: number): boolean {
  if (session.is_aon) return true;          // Always On — never kill on restart
  if (session.ttl === 'forever') return true;

  // kill_timer: if set, only reconnect if downtime < kill_timer duration
  if (session.kill_timer) {
    const timerMs = parseDuration(session.kill_timer);
    if (downtimeMs > timerMs) return false; // expired during outage
  }

  // Fall back to existing TTL logic
  if (!session.last_activity) return true;
  const idleMs = now - new Date(session.last_activity).getTime();
  const ttlMillis = parseDuration(session.ttl || '15m');
  return idleMs < ttlMillis;
}

// Runs periodically — ONLY cleans up soft-deleted sessions past their TTL window.
// Never touches live PTYs.
export function startTtlSweep(pty: PTYClient): void {
  runSweep(pty);
  setInterval(() => runSweep(pty), 60_000);
}

function runSweep(pty: PTYClient): void {
  const now = Date.now();
  const recoverable = queries.listRecoverable();

  for (const session of recoverable) {
    if (session.ttl === 'forever') continue; // AON deleted sessions kept forever

    const deletedAt = new Date(session.deleted_at).getTime();
    const pastWindow = (now - deletedAt) >= ttlMs(session.ttl || '15m');

    if (pastWindow) {
      // Recovery window closed — kill PTY (if still running) and hard-delete
      pty.kill(session.id);
      queries.hardDeleteSession(session.id);
      console.log(`[lifecycle] recovery window expired → purged: ${session.name} (${session.id})`);
    }
  }
}
