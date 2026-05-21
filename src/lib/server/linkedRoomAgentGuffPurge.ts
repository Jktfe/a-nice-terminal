/**
 * linkedRoomAgentGuffPurge — V4-BLOCKER-C one-shot cleanup.
 *
 * The rolled-back T2-RETURN-ROUTING (see T2-ROUTING-ROLLBACK) injected
 * kind='agent' messages into each terminal's linked chat room
 * (terminal_records.linked_chat_room_id, rooms named "Terminal: <name>").
 * Those rows are now stale guff visible in Chat. Real agents post to
 * normal chatrooms via `ant chat send`, NOT to per-terminal linked rooms,
 * so scoping the DELETE to linked-room ids only is safe — it cannot touch
 * legitimate @agent posts in coordination rooms.
 *
 * The DELETE is naturally idempotent (re-run deletes nothing). Booted
 * once via globalThis flag so a server with many restarts doesn't churn.
 */

import { getIdentityDb } from './db';

const BOOT_KEY = '__antLinkedRoomGuffPurged';

export function purgeRouterInjectedAgentMessages(): number {
  const db = getIdentityDb();
  // Only kind='agent' rows AND only in rooms that are some terminal's
  // linked chat room. post_order is UNIQUE so CASCADE/refs stay coherent.
  const result = db.prepare(
    `DELETE FROM chat_messages
      WHERE kind = 'agent'
        AND room_id IN (
          SELECT linked_chat_room_id FROM terminal_records
           WHERE linked_chat_room_id IS NOT NULL
        )`
  ).run();
  return result.changes;
}

/**
 * V4-BLOCKER-C historical transcript dedup. Pre-idempotency-key rows were
 * ingested with NULL transcript_event_id and multiplied up to x68 on every
 * restart. Collapse duplicate (terminal_id, kind, text) groups among those
 * source='transcript' rows, KEEPING the earliest id, SOFT-deleting the
 * rest (deleted_at_ms = now) per JWPK SURFACE-SIZE-ONLY (no hard-delete,
 * no cron — one-shot, manually re-runnable). Idempotent: survivors are
 * unique so a re-run finds nothing new.
 */
export function dedupHistoricalTranscriptRows(): number {
  const db = getIdentityDb();
  const result = db.prepare(
    `UPDATE terminal_run_events
        SET deleted_at_ms = ?
      WHERE deleted_at_ms IS NULL
        AND transcript_event_id IS NULL
        AND source = 'transcript'
        AND id NOT IN (
          SELECT MIN(id) FROM terminal_run_events
           WHERE transcript_event_id IS NULL AND source = 'transcript'
           GROUP BY terminal_id, kind, text
        )`
  ).run(Date.now());
  return result.changes;
}

export function ensureLinkedRoomGuffPurgedOnce(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  try { purgeRouterInjectedAgentMessages(); }
  catch { /* purge is best-effort; never block boot */ }
  // Do not run dedupHistoricalTranscriptRows() at boot. On real dogfood DBs
  // terminal_run_events is multi-GB; the GROUP BY/NOT IN cleanup spills to a
  // huge SQLite temp sort and makes the server listen but stop responding.
  // Keep that function available for explicit maintenance only.
}

export function _resetGuffPurgeBootFlagForTests(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  delete g[BOOT_KEY];
}
