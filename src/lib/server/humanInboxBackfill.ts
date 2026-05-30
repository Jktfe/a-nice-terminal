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
import {
  listDistinctHumanHandles as v02ListDistinctHumanHandles,
  listSharedRoomHumanAgentPairs as v02ListSharedRoomHumanAgentPairs
} from './v02MembershipsStore';

export type BackfillResult = {
  humansSeeded: number;
  edgesEvaluated: number;
};

export function backfillHumanInboxes(): BackfillResult {
  const db = getIdentityDb();
  // 1. Collect every distinct HUMAN handle that's ever been a chat-room
  //    member. (Inbox owners are humans by definition.) @you is included
  //    automatically by Task #138's auto-add-to-every-room.
  //
  // M9d cut-over phase 3: read v0.2 memberships rather than
  // chat_room_members. Both surfaces are dual-written so the result
  // is identical, but the v0.2 read is the new source of truth.
  // Pre-M9d rows with NULL member_kind are missed by the v0.2 query;
  // the legacy chat_room_members union below catches them during the
  // cut-over window so no humans get dropped.
  const v02Humans = v02ListDistinctHumanHandles();
  const legacyHumans = (db.prepare(
    `SELECT DISTINCT handle FROM chat_room_members
     WHERE kind = 'human' AND room_id NOT LIKE '__inbox_%'`
  ).all() as Array<{ handle: string }>).map((row) => row.handle);
  const humanHandles = Array.from(new Set([...v02Humans, ...legacyHumans]));

  for (const handle of humanHandles) ensureHumanInboxRoom(handle);

  // 2. Pair every human against every agent they have shared context
  //    with — either via shared room (path-a) or terminal-ownership
  //    (path-b). The OR is built by UNION; recompute deduplicates.
  //
  // M9d cut-over phase 3: path-a now reads v0.2 memberships. Path-b
  // is unchanged (terminal_records is not a chat_room_members
  // surface). Legacy chat_room_members fallback included so rows
  // pre-dating member_kind ALTER aren't dropped — dedup happens in
  // the recomputeInboxEdge call below.
  const pathAv02 = v02ListSharedRoomHumanAgentPairs();
  const pathALegacyAndB = db.prepare(
    `SELECT DISTINCT human, agent FROM (
       -- Path (a): legacy chat_room_members fallback (catches rows
       -- pre-dating the memberships.member_kind ALTER). Once the
       -- week-2 cleanup PR drops chat_room_members, this UNION arm
       -- disappears.
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
  // Dedup the (human, agent) keys across the two sources before
  // recomputing — recomputeInboxEdge is idempotent but repeated calls
  // inflate the edgesEvaluated count.
  const seen = new Set<string>();
  const pairs: Array<{ human: string; agent: string }> = [];
  for (const pair of [...pathAv02, ...pathALegacyAndB]) {
    const key = `${pair.human}${pair.agent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(pair);
  }

  for (const { human, agent } of pairs) recomputeInboxEdge(human, agent);

  return { humansSeeded: humanHandles.length, edgesEvaluated: pairs.length };
}
