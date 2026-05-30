/**
 * One-shot backfill: every existing human handle gets an inbox + the
 * correct initial membership set computed from the live snapshot of
 * chat_room_members + terminal_records.created_by.
 *
 * Runs idempotently — re-running over already-backfilled data is a no-op
 * because ensureHumanInboxRoom + recomputeInboxEdge are both safe upserts.
 *
 * Called from db.ts getIdentityDb() boot path so the first request after
 * deploying this code gets the live data in place. Cheap: O(humans) +
 * O(human × agent pairs that share context) — both small in practice.
 */

import { getIdentityDb } from './db';
import { ensureHumanInboxRoom } from './humanInboxRoomStore';
import { recomputeInboxEdge } from './humanInboxMembership';

export type BackfillResult = {
  humansSeeded: number;
  edgesEvaluated: number;
};

export function backfillHumanInboxes(): BackfillResult {
  const db = getIdentityDb();
  // 1. Collect every distinct HUMAN handle that's ever been a chat-room
  //    member. (Inbox owners are humans by definition.) @you is included
  //    automatically by Task #138's auto-add-to-every-room.
  const humanHandles = (db.prepare(
    `SELECT DISTINCT handle FROM chat_room_members
     WHERE kind = 'human' AND room_id NOT LIKE '__inbox_%'`
  ).all() as Array<{ handle: string }>).map((row) => row.handle);

  for (const handle of humanHandles) ensureHumanInboxRoom(handle);

  // 2. Pair every human against every agent they have shared context
  //    with — either via shared room (path-a) or terminal-ownership
  //    (path-b). The OR is built by UNION; recompute deduplicates.
  const pairs = db.prepare(
    `SELECT DISTINCT human, agent FROM (
       -- Path (a): pairs from a shared non-inbox room
       SELECT h.handle AS human, a.handle AS agent
       FROM chat_room_members h
       JOIN chat_room_members a ON h.room_id = a.room_id
       WHERE h.kind = 'human' AND a.kind = 'agent'
         AND h.room_id NOT LIKE '__inbox_%'
       UNION
       -- Path (b): pairs from terminal ownership. Pane-binding
       -- supersession filter (JWPK 2026-05-27): superseded rows do
       -- NOT contribute backfill edges — the prior agent on a
       -- recycled pane should not retain inbox membership through
       -- a stale record.
       SELECT created_by AS human, handle AS agent
       FROM terminal_records
       WHERE created_by IS NOT NULL AND handle IS NOT NULL
         AND superseded_at_ms IS NULL
     )`
  ).all() as Array<{ human: string; agent: string }>;

  for (const { human, agent } of pairs) recomputeInboxEdge(human, agent);

  return { humansSeeded: humanHandles.length, edgesEvaluated: pairs.length };
}
