// Phase C of server-split-2026-05-11 — catch-up loop. Loads
// broadcast_state='pending' rows (typically left behind by an offline
// Tier-2 crash or by a Phase D CLI direct-write before the server
// notify endpoint could fire) and replays them through runSideEffects
// so the live consumers (channel webhooks, WS subscribers, asks) see
// the message as soon as the server is back up.
//
// Three load-bearing invariants:
//
//   1. Replays NEVER create new asks. Ask creation is Tier 1 (lives
//      inside writeMessage's transaction) and runs exactly once when
//      the row was originally written. On replay we LOAD the existing
//      asks via queries.getAsksByMessage and feed them into the
//      WriteMessageResult shape that runSideEffects expects, so the
//      WS ask_created envelopes are re-broadcast but no new ask rows
//      are written. inferAskFromMessage must never be called here.
//
//   2. Messages older than the PTY-injection window (30s) replay
//      with allowPtyInject=false. runSideEffects forwards that to
//      router.route, which then refuses to pick the pty-injection
//      adapter — stale typed input cannot land in a running agent's
//      stdin even if a terminal session is open.
//
//   3. Messages older than the absolute retention window (default
//      24h) are marked broadcast_state='expired' in the same scan
//      rather than replayed. This keeps the partial index small and
//      makes the failure mode visible: an expired row is a row we
//      consciously gave up on, not a row that silently rotted in
//      the queue.
//
// Concurrent runs (5s poller + /api/internal/notify-new-message both
// arriving at once) are gated by a module-scoped isReplaying flag.
// A second call while one is in flight returns 0 immediately.

import { queries } from '$lib/server/db';
import { broadcastQueue, resolveSenderSession } from '$lib/persist';
import type { PersistedMessage, WriteMessageResult } from '$lib/persist';
import { runSideEffects } from './run-side-effects.js';

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PTY_INJECT_WINDOW_MS = 30_000;
const REPLAY_BATCH_LIMIT = 100;

/** Pure helper exported for unit tests. Returns true when a message
 *  of the given age is still inside the PTY-injection window. */
export function shouldAllowPtyInject(ageMs: number): boolean {
  return ageMs < PTY_INJECT_WINDOW_MS;
}

/** Pure helper exported for unit tests. Returns true when a message
 *  of the given age has exceeded the retention window. */
export function isExpired(ageMs: number, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  return ageMs > maxAgeMs;
}

let isReplaying = false;

interface PendingRow extends PersistedMessage {
  created_at?: string;
  broadcast_attempts?: number;
}

function parseCreatedAtMs(createdAt: string | undefined): number {
  if (!createdAt) return 0;
  // SQLite datetime('now') emits 'YYYY-MM-DD HH:MM:SS' — Date.parse
  // accepts that on macOS/Node but treats it as local time. Normalise
  // to UTC by appending Z so replays don't drift by the host timezone.
  const normalised = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? ms : 0;
}

function reconstructResult(row: PendingRow): WriteMessageResult {
  const existingAsks = (queries.getAsksByMessage(row.id) as any[]) ?? [];
  const senderResolved = resolveSenderSession(row.sender_id);
  const linkedTerminals = queries.getTerminalsByLinkedChat(row.session_id) as unknown[];
  const isLinkedChat = Array.isArray(linkedTerminals) && linkedTerminals.length > 0;
  return {
    message: row as unknown as PersistedMessage,
    asks: existingAsks,
    firstPost: false,
    isLinkedChat,
    senderResolved,
    routingHints: {
      askIds: existingAsks.map((ask) => ask.id),
    },
  };
}

/** Replay every broadcast_state='pending' row that is within the
 *  retention window. Returns the number of rows successfully
 *  replayed (markDone). Rows older than maxAgeMs are marked
 *  'expired' (counted separately in expiredCount via the caller's
 *  log line; this function returns only the replay tally).
 *
 *  Concurrent invocations short-circuit to 0 — see isReplaying. */
export async function replayPendingBroadcasts(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<number> {
  if (isReplaying) return 0;
  isReplaying = true;
  let replayed = 0;
  try {
    const now = Date.now();
    const pending = broadcastQueue.listPending(REPLAY_BATCH_LIMIT) as PendingRow[];

    for (const row of pending) {
      const createdAtMs = parseCreatedAtMs(row.created_at);
      const ageMs = createdAtMs > 0 ? now - createdAtMs : 0;

      // Expired rows: explicit mark, do NOT replay. Keeps the
      // partial index from accumulating rotted-out rows forever.
      if (createdAtMs > 0 && isExpired(ageMs, maxAgeMs)) {
        broadcastQueue.markExpired(row.id);
        continue;
      }

      const allowPtyInject = shouldAllowPtyInject(ageMs);

      try {
        const result = reconstructResult(row);
        await runSideEffects(result, { replay: true, allowPtyInject });
        replayed++;
      } catch {
        // runSideEffects' own catch path handles broadcast_attempts
        // bookkeeping (bump + mark 'failed' after 5). Catch-up swallows
        // the throw so one bad row doesn't abort the rest of the batch.
      }
    }
  } finally {
    isReplaying = false;
  }
  return replayed;
}

/** Test-only escape hatch. Resets the isReplaying flag between tests
 *  so unit tests don't have to wait for the previous cycle to finish.
 *  NEVER call from production code. */
export function _resetForTest(): void {
  isReplaying = false;
}
