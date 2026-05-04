// ANT v3 — Session Lifecycle Manager
//
// TTL governs two things only:
//  1. Whether to respawn a session after a daemon restart (was it recent enough to bother?)
//  2. The soft-delete recovery window (how long before a deleted session is gone for good)
//
// A LIVE running PTY is NEVER killed based on idle time.
// User-initiated terminal DELETE kills the live PTY immediately. The only
// automatic kills are idempotent cleanup for soft-deleted sessions past their
// TTL window.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { queries, ttlMs } from './db.js';
import { readDeckMeta, registerDeck, type DeckMeta } from './decks.js';
import { obsidianVaultPath } from './capture/obsidian-writer.js';

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
    // Soft-deleted sessions: never reconnect. Terminal deletes should have
    // already killed their PTY; the row stays recoverable until restored or
    // expired.
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

    if (!pastWindow) continue;

    // Housekeeping must never crash the server. Any failure on a single
    // session is logged and skipped; the next sweep retries.
    try {
      // Re-home or archive decks owned by this session before hard-delete,
      // so FK constraints on decks.owner_session_id don't block the purge.
      rehomeOrArchiveOrphanDecks(session.id);

      pty.kill(session.id);
      queries.hardDeleteSession(session.id);
      void disposeSessionState(session.id).catch((e) => {
        console.warn(`[lifecycle] failed to dispose purged session ${session.id}:`, e);
      });
      console.log(`[lifecycle] recovery window expired → purged: ${session.name} (${session.id})`);
    } catch (e) {
      console.warn(`[lifecycle] failed to purge ${session.id} (${session.name}); will retry next sweep:`, e);
    }
  }
}

// When a session that owns decks is hard-purged, transfer ownership to the
// first still-live entry in allowed_room_ids (original order). If nothing
// remains, write a recovery note to the Obsidian vault and drop the row so
// the FK constraint stops blocking the session purge.
function rehomeOrArchiveOrphanDecks(sessionId: string): void {
  const rows = queries.listDecksOwnedBy(sessionId) as any[];
  for (const row of rows) {
    const deck = readDeckMeta(String(row.slug));
    if (!deck) continue;

    const candidates = deck.allowed_room_ids.filter((id) => id !== sessionId);
    let newOwnerId: string | null = null;
    for (const id of candidates) {
      const candidate = queries.getSession(id) as any;
      if (candidate && !candidate.deleted_at && candidate.archived === 0) {
        newOwnerId = id; // original-order: first live wins
        break;
      }
    }

    if (newOwnerId) {
      registerDeck({
        slug: deck.slug,
        owner_session_id: newOwnerId,
        allowed_room_ids: candidates, // strip the purged owner from the allow-list
      });
      console.log(`[lifecycle] re-homed deck ${deck.slug}: ${sessionId} → ${newOwnerId}`);
    } else {
      archiveOrphanDeckToObsidian(deck, sessionId);
      queries.deleteDeck(deck.slug);
      console.log(`[lifecycle] archived orphan deck ${deck.slug} (no live re-home target)`);
    }
  }
}

function archiveOrphanDeckToObsidian(deck: DeckMeta, originalOwnerId: string): void {
  const vault = obsidianVaultPath();
  if (!existsSync(vault)) {
    console.warn(`[lifecycle] obsidian vault not found at ${vault} — deck ${deck.slug} metadata only in logs`);
    return;
  }
  const dir = join(vault, 'decks', 'orphaned');
  mkdirSync(dir, { recursive: true });
  const archivedAt = new Date();
  const stamp = archivedAt.toISOString().replace(/[:.]/g, '-');
  const filepath = join(dir, `${deck.slug}-${stamp}.md`);

  const recoverPayload = JSON.stringify({
    slug: deck.slug,
    owner_session_id: '<NEW_SESSION_ID>',
    allowed_room_ids: deck.allowed_room_ids,
    deck_dir: deck.deck_dir,
    dev_port: deck.dev_port,
  });

  const md =
`---
type: orphan-deck
slug: ${deck.slug}
deck_dir: ${deck.deck_dir}
original_owner_session_id: ${originalOwnerId}
allowed_room_ids: ${JSON.stringify(deck.allowed_room_ids)}
dev_port: ${deck.dev_port ?? 'null'}
created_at: ${deck.created_at ?? 'null'}
archived_at: ${archivedAt.toISOString()}
---

# Orphan deck: ${deck.slug}

The session (\`${originalOwnerId}\`) that owned this deck was hard-purged on
${archivedAt.toISOString()}. No other live session in \`allowed_room_ids\`
was available to take ownership.

**Files are still on disk** at:

    ${deck.deck_dir}

## Re-register against another session

\`\`\`
curl -k -X POST https://localhost:6458/api/decks \\
  -H "Content-Type: application/json" \\
  -d '${recoverPayload}'
\`\`\`
`;

  writeFileSync(filepath, md, 'utf8');
  console.log(`[lifecycle] orphan deck archive: ${filepath}`);
}

// Drop in-memory state held by other server modules (agent-event-bus, prompt-bridge).
// Safe to call on archive, soft-delete, or hard-delete; if state was never populated
// these dispose calls are no-ops. Without this, deleted sessions leak SessionState
// entries and emit zombie agent_status_updated broadcasts forever.
export async function disposeSessionState(sessionId: string): Promise<void> {
  const [{ dispose: disposeAgentEvents }, { disposePromptBridge }] = await Promise.all([
    import('./agent-event-bus.js'),
    import('./prompt-bridge.js'),
  ]);
  disposeAgentEvents(sessionId);
  disposePromptBridge(sessionId);
}
