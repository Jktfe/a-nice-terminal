/**
 * membershipRosterBackfill — the correctness-critical R3 roster consolidation.
 *
 * A live anti-join proved the clean room_membership roster is NOT a superset of
 * the legacy membership tables: ~32 members exist in chat_room_members / v0.2
 * memberships but not in room_memberships, so backfilling from one source drops
 * them on the read-flip. The fix is to union ALL legacy sources — but a NAIVE
 * union on the raw handle string creates DUPLICATES, because one identity wears
 * different handle strings across tables (operator @you↔@JWPK; the @x-N suffix).
 *
 * So "lossless" must hold in BOTH directions, dedup'd on the CANONICAL identity:
 *   1. no DROPS  — the clean roster is a superset of every legacy source.
 *   2. no DUPES  — one identity → one room_membership row per room.
 *
 * Canonical identity key, by TIER precedence (highest available per row):
 *   1. agentID                — the durable R3 spine (getLiveAgentByHandle)
 *   2. session / terminal      — ant_sessions row the handle resolves to
 *   3. lease owner-at-time     — findRoomHandleOwnerAtTime (who held it)
 *   4. operator canonicalise   — @you → @JWPK
 *   5. handle-base FALLBACK     — only when 1–4 give nothing; NEVER string-merged
 *
 * FAIL-SAFE (the tie-breaker that makes ambiguity safe): a false MERGE silently
 * drops a participant (the exact bug we're killing); a false SPLIT shows a
 * visible duplicate (recoverable). So we NEVER merge two rows unless tiers 1–4
 * PROVE them the same identity. Tier-5 rows keep their distinct raw handle and
 * are reported separately for audit — never collapsed by string similarity.
 */

import { getIdentityDb } from './db';
import {
  addMember,
  setMemberIdentityKey,
  isDurableMemberHandle,
  durableMemberWhereClause
} from './membershipStore';
import { getLiveAgentByHandle } from './v02AgentsStore';
import { canonicaliseOperatorHandle, isOperatorHandle } from './operatorHandle';
import { findRoomHandleOwnerAtTime } from './roomHandleLeaseStore';

export type CanonicalTier = 1 | 2 | 3 | 4 | 5;
export type CanonicalMember = {
  /** The handle the clean room_membership row is written under. Identities that
   *  resolve to the same canonical handle dedup via UNIQUE(room_id, handle). */
  canonicalHandle: string;
  /** The identity the dedup is PROVEN on (agent:… / session:… / lease:… /
   *  operator:… / handle:… for tier-5). Distinct keys are never merged. */
  identityKey: string;
  tier: CanonicalTier;
};

function normaliseHandle(rawHandle: string): string {
  const t = rawHandle.trim();
  return t.startsWith('@') ? t : `@${t}`;
}

/**
 * Resolve a (room, raw handle) to its canonical identity by the tier precedence.
 * Pure-ish (reads the identity tables). The operator canonicalisation is applied
 * as a normalisation BEFORE the higher tiers so @you and @JWPK resolve through
 * the same agent/session/lease.
 */
export function resolveCanonicalMember(
  roomId: string,
  rawHandle: string,
  db = getIdentityDb()
): CanonicalMember {
  const handle = normaliseHandle(rawHandle);
  const opCanon = canonicaliseOperatorHandle(handle); // @you → @JWPK

  // Tier 1 — durable agentID (the spine). Highest-confidence identity.
  const agent = getLiveAgentByHandle(opCanon, db);
  if (agent) {
    return { canonicalHandle: agent.primary_handle, identityKey: `agent:${agent.agent_id}`, tier: 1 };
  }

  // Tier 2 — session/terminal binding: a live ant_sessions row labelled this handle.
  // (Guarded — ant_sessions may not exist on a partial/test DB; skip the tier.)
  const hasSessions =
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='ant_sessions'`).get() !== undefined;
  if (hasSessions) {
    const session = db
      .prepare(`SELECT id FROM ant_sessions WHERE label = ? ORDER BY last_seen_at_ms DESC LIMIT 1`)
      .get(opCanon) as { id: string } | undefined;
    if (session) {
      return { canonicalHandle: opCanon, identityKey: `session:${session.id}`, tier: 2 };
    }
  }

  // Tier 3 — lease owner-at-time: who held this room handle.
  const owner = findRoomHandleOwnerAtTime({ roomId, handle: opCanon, atMs: Date.now() }, db);
  if (owner) {
    return { canonicalHandle: opCanon, identityKey: `lease:${owner.sessionId}`, tier: 3 };
  }

  // Tier 4 — operator canonicalisation actually collapsed the handle (@you→@JWPK)
  // even though no agent/session/lease resolved. Proven-same via the operator rule.
  if (isOperatorHandle(handle)) {
    return { canonicalHandle: opCanon, identityKey: `operator:${opCanon}`, tier: 4 };
  }

  // Tier 5 — FALLBACK. No identity proof. Keep the raw handle DISTINCT (room-scoped
  // key) so two unproven rows are never merged by string similarity (fail-safe).
  return { canonicalHandle: handle, identityKey: `handle:${roomId}:${handle}`, tier: 5 };
}

export type RosterBackfillReport = {
  /** Rows examined per legacy source. */
  sources: { chat_room_members: number; room_memberships: number; memberships: number };
  /** Canonical members written (after dedup) + how each resolved, by tier. */
  tierCounts: Record<CanonicalTier, number>;
  /** Tier-5 fallback rows, listed explicitly for the audit (never auto-merged). */
  fallbackRows: Array<{ room_id: string; handle: string }>;
  /** Distinct canonical (room, identityKey) pairs written. */
  written: number;
  /** Legacy rows skipped as non-durable browser-session synthetic handles. */
  skippedBrowserSessions: number;
  /** Existing synthetic rows purged from the canonical clean roster. */
  purgedBrowserSessions: number;
};

function tableExists(db: ReturnType<typeof getIdentityDb>, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name) !== undefined;
}
function columnExists(db: ReturnType<typeof getIdentityDb>, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (c) => c.name === col
  );
}

/**
 * Populate room_membership from the UNION of every legacy membership source,
 * dedup'd on the canonical identity (resolveCanonicalMember). Idempotent
 * (addMember upserts on UNIQUE(room_id, handle)). Returns the audit report the
 * read-flip PR carries (per-tier counts + the tier-5 fallback list).
 */
export function backfillRosterFromAllLegacy(db = getIdentityDb()): RosterBackfillReport {
  const report: RosterBackfillReport = {
    sources: { chat_room_members: 0, room_memberships: 0, memberships: 0 },
    tierCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    fallbackRows: [],
    written: 0,
    skippedBrowserSessions: 0,
    purgedBrowserSessions: 0
  };

  if (tableExists(db, 'room_membership')) {
    const purged = db
      .prepare(`DELETE FROM room_membership WHERE NOT (${durableMemberWhereClause()})`)
      .run();
    report.purgedBrowserSessions += purged.changes;
  }
  if (tableExists(db, 'room_member_presentation')) {
    db.prepare(`DELETE FROM room_member_presentation WHERE NOT (${durableMemberWhereClause()})`).run();
  }
  // De-dup tracking so the per-tier + written counts reflect DISTINCT identities,
  // not raw rows (two raw handles → one canonical identity counts once).
  const seen = new Set<string>();

  const ingest = (roomId: string, rawHandle: string): void => {
    if (!roomId || !rawHandle) return;
    // Browser-session synthetic handles are not durable members — the live read
    // hides them, so the clean roster must too (see isDurableMemberHandle).
    if (!isDurableMemberHandle(rawHandle)) {
      report.skippedBrowserSessions++;
      return;
    }
    const canon = resolveCanonicalMember(roomId, rawHandle, db);
    addMember(roomId, canon.canonicalHandle, null, db);
    // Persist the resolved identity ON DISK so the proof verifies the stored
    // roster, not a re-derivation (a mis-write then FAILS the proof).
    setMemberIdentityKey(roomId, canon.canonicalHandle, canon.identityKey, db);
    const dedupKey = `${roomId}|${canon.identityKey}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    report.tierCounts[canon.tier]++;
    report.written++;
    if (canon.tier === 5) report.fallbackRows.push({ room_id: roomId, handle: canon.canonicalHandle });
  };

  if (tableExists(db, 'chat_room_members')) {
    const rows = db.prepare(`SELECT room_id, handle FROM chat_room_members`).all() as Array<{
      room_id: string;
      handle: string;
    }>;
    for (const r of rows) {
      report.sources.chat_room_members++;
      ingest(r.room_id, r.handle);
    }
  }

  if (tableExists(db, 'room_memberships')) {
    const where = columnExists(db, 'room_memberships', 'revoked_at_ms') ? `WHERE revoked_at_ms IS NULL` : ``;
    const rows = db.prepare(`SELECT room_id, handle FROM room_memberships ${where}`).all() as Array<{
      room_id: string;
      handle: string;
    }>;
    for (const r of rows) {
      report.sources.room_memberships++;
      ingest(r.room_id, r.handle);
    }
  }

  if (tableExists(db, 'memberships') && tableExists(db, 'agents')) {
    const leftCol = columnExists(db, 'memberships', 'left_at_ms') ? `WHERE m.left_at_ms IS NULL` : ``;
    const rows = db
      .prepare(
        `SELECT m.room_id AS room_id, a.primary_handle AS handle
           FROM memberships m JOIN agents a ON a.agent_id = m.agent_id ${leftCol}`
      )
      .all() as Array<{ room_id: string; handle: string }>;
    for (const r of rows) {
      report.sources.memberships++;
      ingest(r.room_id, r.handle);
    }
  }

  return report;
}

export type VerifyReport = {
  /** How many distinct identities resolved at each tier (audit, re-derived). */
  tierCounts: Record<CanonicalTier, number>;
  /** Tier-5 fallback identities, listed explicitly. */
  fallbackRows: Array<{ room_id: string; handle: string }>;
  /** NO-DROPS: legacy members whose resolved identity is NOT in the PERSISTED
   *  room_membership.identity_key set (must be empty for a lossless flip). */
  noDrops: { count: number; details: Array<{ room_id: string; handle: string; identityKey: string }> };
  /** NO-DUPES: one persisted identity under >1 handle in a room (a false split). */
  noDupes: { count: number; details: Array<{ room_id: string; identity_key: string; handles: string }> };
  /** NON-DURABLE: persisted synthetic browser-session handles in clean roster. */
  nonDurable: { count: number; details: Array<{ room_id: string; handle: string }> };
};

/** Iterate every active legacy member (room_id, raw handle) across all sources. */
function forEachLegacyMember(
  db: ReturnType<typeof getIdentityDb>,
  cb: (roomId: string, rawHandle: string) => void
): void {
  if (tableExists(db, 'chat_room_members')) {
    for (const r of db.prepare(`SELECT room_id, handle FROM chat_room_members`).all() as Array<{
      room_id: string;
      handle: string;
    }>) {
      // Skip browser-session synthetic handles so the proof's notion of "legacy
      // members" matches what the backfill actually writes (else all 715 would
      // read as drops). Single source of truth: isDurableMemberHandle.
      if (isDurableMemberHandle(r.handle)) cb(r.room_id, r.handle);
    }
  }
  if (tableExists(db, 'room_memberships')) {
    const where = columnExists(db, 'room_memberships', 'revoked_at_ms') ? `WHERE revoked_at_ms IS NULL` : ``;
    for (const r of db.prepare(`SELECT room_id, handle FROM room_memberships ${where}`).all() as Array<{
      room_id: string;
      handle: string;
    }>) {
      // Skip browser-session synthetic handles so the proof's notion of "legacy
      // members" matches what the backfill actually writes (else all 715 would
      // read as drops). Single source of truth: isDurableMemberHandle.
      if (isDurableMemberHandle(r.handle)) cb(r.room_id, r.handle);
    }
  }
  if (tableExists(db, 'memberships') && tableExists(db, 'agents')) {
    const leftCol = columnExists(db, 'memberships', 'left_at_ms') ? `WHERE m.left_at_ms IS NULL` : ``;
    for (const r of db
      .prepare(
        `SELECT m.room_id AS room_id, a.primary_handle AS handle
           FROM memberships m JOIN agents a ON a.agent_id = m.agent_id ${leftCol}`
      )
      .all() as Array<{ room_id: string; handle: string }>)
      cb(r.room_id, r.handle);
  }
}

/**
 * The lossless+injective PROOF, read off the PERSISTED room_membership.identity_key
 * (NOT a re-run of the backfill — a mis-written row therefore FAILS the proof).
 * Run against a WAL-trio copy (proof.db), never live pre-deploy. A green flip
 * requires noDrops.count === 0 AND noDupes.count === 0.
 */
export function verifyRosterConsolidation(db = getIdentityDb()): VerifyReport {
  // PERSISTED clean roster identity sets, read off disk.
  const persisted = new Map<string, Set<string>>();
  for (const r of db.prepare(`SELECT room_id, identity_key FROM room_membership`).all() as Array<{
    room_id: string;
    identity_key: string | null;
  }>) {
    if (!r.identity_key) continue;
    if (!persisted.has(r.room_id)) persisted.set(r.room_id, new Set());
    persisted.get(r.room_id)!.add(r.identity_key);
  }

  const tierCounts: Record<CanonicalTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const fallbackRows: Array<{ room_id: string; handle: string }> = [];
  const dropDetails: Array<{ room_id: string; handle: string; identityKey: string }> = [];
  const seen = new Set<string>();

  forEachLegacyMember(db, (roomId, rawHandle) => {
    if (!roomId || !rawHandle) return;
    const canon = resolveCanonicalMember(roomId, rawHandle, db);
    const dedup = `${roomId}|${canon.identityKey}`;
    if (!seen.has(dedup)) {
      seen.add(dedup);
      tierCounts[canon.tier]++;
      if (canon.tier === 5) fallbackRows.push({ room_id: roomId, handle: canon.canonicalHandle });
    }
    // NO-DROPS: the legacy identity must be in the PERSISTED disk set.
    if (!persisted.get(roomId)?.has(canon.identityKey)) {
      dropDetails.push({ room_id: roomId, handle: rawHandle, identityKey: canon.identityKey });
    }
  });

  // NO-DUPES: one persisted identity_key under >1 handle in a room.
  const dupeDetails = db
    .prepare(
      `SELECT room_id, identity_key, COUNT(*) AS c, group_concat(handle) AS handles
         FROM room_membership WHERE identity_key IS NOT NULL
         GROUP BY room_id, identity_key HAVING c > 1`
    )
    .all() as Array<{ room_id: string; identity_key: string; c: number; handles: string }>;
  const nonDurableDetails = db
    .prepare(
      `SELECT room_id, handle FROM room_membership
        WHERE NOT (${durableMemberWhereClause()})
        ORDER BY room_id, handle`
    )
    .all() as Array<{ room_id: string; handle: string }>;

  return {
    tierCounts,
    fallbackRows,
    noDrops: { count: dropDetails.length, details: dropDetails },
    noDupes: {
      count: dupeDetails.length,
      details: dupeDetails.map((d) => ({ room_id: d.room_id, identity_key: d.identity_key, handles: d.handles }))
    },
    nonDurable: { count: nonDurableDetails.length, details: nonDurableDetails }
  };
}
