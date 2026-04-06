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

// Called once when the server starts and connects to the daemon.
//
// Normal case (web server restarted, daemon still running):
//   The daemon's PTYs are already alive. `pty.spawn()` just reconnects and
//   returns the scrollback buffer — nothing is started.
//
// Rare case (full system reboot, daemon also restarted):
//   PTYs are gone. `pty.spawn()` creates a new shell — but ONLY for sessions
//   whose TTL says they should still exist (AON always, others by last_activity).
export async function rehydrateSessions(pty: PTYClient): Promise<void> {
  const sessions = queries.listTerminalSessions();
  const now = Date.now();
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

    // AON or within TTL window → connect (or reconnect) to the daemon
    if (shouldConnectAfterRestart(session, now)) {
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
// AON: always. Others: only if last_activity is within the TTL window.
// This is purely a restart-time decision — live sessions are NEVER killed by this.
function shouldConnectAfterRestart(session: any, now: number): boolean {
  if (session.ttl === 'forever') return true;

  const lastActive = session.last_activity || session.updated_at || session.created_at;
  if (!lastActive) return false;
  const lastActiveMs = new Date(lastActive).getTime();
  return (now - lastActiveMs) < ttlMs(session.ttl || '15m');
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
