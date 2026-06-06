/**
 * entityClaimStore — 5-way convergent claim ledger.
 *
 * Backs the 🖐️ looking / 🤝 working / 👐 pass primitive ratified via
 * ask_hj2ubjbum8dmpce8dc1. First-write-wins on (entity_kind, entity_id,
 * claim_kind, claimed_by_handle) where status = active — so:
 *
 *  - At most one agent can have an ACTIVE 🤝 working claim per message,
 *    enforced via INSERT-then-409 (the actual single-claimant rule for
 *    working is in the route handler — the DB allows multiple agents'
 *    rows so coordinator can see who lost the race).
 *  - Each agent can independently 👐 pass (negative claim — routing
 *    hint, never blocks).
 *  - 🖐️ looking has a short 90s TTL; 🤝 working uses the focus-style
 *    picker (15m / 30m default heads-down / 45m / 1h / 2h / custom /
 *    indefinite); 👐 pass is persistent (no TTL).
 *
 * The store is the canonical truth. The chat-message kind=claim emitted
 * on every successful claim is a visibility echo for pty-inject fanout —
 * never the source of truth.
 *
 * Schema lives in db.ts (entity_claims table).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type EntityKind = 'message' | 'task';
export type ClaimKind = 'looking' | 'working' | 'pass';
export type ClaimStatus = 'active' | 'done' | 'released' | 'expired';

export type EntityClaim = {
  id: string;
  entity_kind: EntityKind;
  entity_id: string;
  claim_kind: ClaimKind;
  claimed_by_handle: string;
  status: ClaimStatus;
  ttl_ms: number | null;
  expires_at_ms: number | null;
  claimed_at_ms: number;
  released_at_ms: number | null;
  override_reason: string | null;
};

type ClaimRow = {
  id: string;
  entity_kind: EntityKind;
  entity_id: string;
  claim_kind: ClaimKind;
  claimed_by_handle: string;
  status: ClaimStatus;
  ttl_ms: number | null;
  expires_at_ms: number | null;
  claimed_at_ms: number;
  released_at_ms: number | null;
  override_reason: string | null;
};

function rowToClaim(row: ClaimRow): EntityClaim {
  return { ...row };
}

// Default TTLs in milliseconds. Looking is short (it's a "I'm reading
// this" courtesy signal, not a work lock). Working defaults depend on
// room mode and are passed in by the caller. Pass is persistent.
const LOOKING_TTL_MS = 90_000;
export const DEFAULT_WORKING_TTL_BRAINSTORM_MS = 15 * 60_000;
export const DEFAULT_WORKING_TTL_HEADS_DOWN_MS = 30 * 60_000;

export type CreateClaimInput = {
  entity_kind: EntityKind;
  entity_id: string;
  claim_kind: ClaimKind;
  claimed_by_handle: string;
  /** Optional TTL in ms. Required for working when caller wants a
   *  specific window; otherwise the default for the room mode applies.
   *  Ignored for looking (always 90s) and pass (always null). */
  ttl_ms?: number | null;
  /** Optional default-working-TTL passed in by the route based on the
   *  caller's room mode (brainstorm vs heads-down). Falls back to the
   *  brainstorm constant when omitted. */
  default_working_ttl_ms?: number;
};

export class EntityClaimConflictError extends Error {
  /** The currently-active conflicting claim. Surface to caller so the
   *  UI can render "claimed by @X, 12m left". */
  public readonly existing: EntityClaim;

  constructor(existing: EntityClaim) {
    super(
      `entity ${existing.entity_kind}:${existing.entity_id} kind=${existing.claim_kind} already claimed by ${existing.claimed_by_handle}`
    );
    this.name = 'EntityClaimConflictError';
    this.existing = existing;
  }
}

function resolveTtlMs(input: CreateClaimInput): number | null {
  if (input.claim_kind === 'pass') return null;
  if (input.claim_kind === 'looking') return LOOKING_TTL_MS;
  // working
  if (typeof input.ttl_ms === 'number' && input.ttl_ms > 0) return input.ttl_ms;
  if (input.ttl_ms === null) return null; // indefinite
  return input.default_working_ttl_ms ?? DEFAULT_WORKING_TTL_BRAINSTORM_MS;
}

/**
 * Insert a claim. For 🤝 working, conflicts with an existing active
 * working claim from a DIFFERENT agent surface as EntityClaimConflictError.
 * For 🖐️ looking + 👐 pass, multiple rows (one per agent) coexist.
 *
 * Same agent re-claiming the same kind on the same entity is a no-op
 * — returns the existing row.
 */
export function createClaim(input: CreateClaimInput): EntityClaim {
  const db = getIdentityDb();
  const nowMs = Date.now();
  const ttlMs = resolveTtlMs(input);
  const expiresAtMs = ttlMs === null ? null : nowMs + ttlMs;

  // First: opportunistically expire any stale rows in this entity slot so
  // the conflict check below doesn't trip on a dead claim. Cheap query,
  // bounded by the (entity_kind, entity_id, status) index.
  db.prepare(
    `UPDATE entity_claims
     SET status = 'expired'
     WHERE status = 'active'
       AND entity_kind = ?
       AND entity_id = ?
       AND expires_at_ms IS NOT NULL
       AND expires_at_ms < ?`
  ).run(input.entity_kind, input.entity_id, nowMs);

  if (input.claim_kind === 'working') {
    const conflict = db.prepare(
      `SELECT * FROM entity_claims
       WHERE entity_kind = ? AND entity_id = ?
         AND claim_kind = 'working' AND status = 'active'
       LIMIT 1`
    ).get(input.entity_kind, input.entity_id) as ClaimRow | undefined;
    if (conflict) {
      if (conflict.claimed_by_handle === input.claimed_by_handle) {
        // Same agent already holds the claim — idempotent, return the
        // existing row.
        return rowToClaim(conflict);
      }
      throw new EntityClaimConflictError(rowToClaim(conflict));
    }
  } else {
    // looking / pass: check for an existing row from the same agent so
    // the second click is a no-op rather than creating a duplicate.
    const existing = db.prepare(
      `SELECT * FROM entity_claims
       WHERE entity_kind = ? AND entity_id = ?
         AND claim_kind = ? AND claimed_by_handle = ? AND status = 'active'
       LIMIT 1`
    ).get(input.entity_kind, input.entity_id, input.claim_kind, input.claimed_by_handle) as ClaimRow | undefined;
    if (existing) return rowToClaim(existing);
  }

  const id = `clm_${randomUUID()}`;
  db.prepare(
    `INSERT INTO entity_claims
       (id, entity_kind, entity_id, claim_kind, claimed_by_handle, status,
        ttl_ms, expires_at_ms, claimed_at_ms, released_at_ms, override_reason)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL)`
  ).run(
    id,
    input.entity_kind,
    input.entity_id,
    input.claim_kind,
    input.claimed_by_handle,
    ttlMs,
    expiresAtMs,
    nowMs
  );

  const stored = db.prepare(`SELECT * FROM entity_claims WHERE id = ?`).get(id) as ClaimRow;
  return rowToClaim(stored);
}

/**
 * Mark a claim done or released. Idempotent — already-terminal rows
 * return unchanged. Returns the updated claim, or null if missing.
 */
export function updateClaimStatus(
  id: string,
  status: 'done' | 'released',
  options: { override_reason?: string | null } = {}
): EntityClaim | null {
  const db = getIdentityDb();
  const existing = db.prepare(`SELECT * FROM entity_claims WHERE id = ?`).get(id) as ClaimRow | undefined;
  if (!existing) return null;
  if (existing.status !== 'active') return rowToClaim(existing);
  const nowMs = Date.now();
  db.prepare(
    `UPDATE entity_claims
     SET status = ?, released_at_ms = ?, override_reason = ?
     WHERE id = ?`
  ).run(status, nowMs, options.override_reason ?? null, id);
  const updated = db.prepare(`SELECT * FROM entity_claims WHERE id = ?`).get(id) as ClaimRow;
  return rowToClaim(updated);
}

/**
 * List ACTIVE claims for a given entity. Returns all kinds in one call
 * so the UI chip + the routing gate use the same shape. Stale rows are
 * lazy-expired by createClaim above; this read also filters by
 * expires_at_ms so a row that hit its TTL between writes is reported
 * correctly even before the next mutation.
 */
export function listActiveClaimsForEntity(
  entity_kind: EntityKind,
  entity_id: string
): EntityClaim[] {
  const db = getIdentityDb();
  const nowMs = Date.now();
  const rows = db.prepare(
    `SELECT * FROM entity_claims
     WHERE entity_kind = ? AND entity_id = ? AND status = 'active'
       AND (expires_at_ms IS NULL OR expires_at_ms > ?)
     ORDER BY claimed_at_ms ASC`
  ).all(entity_kind, entity_id, nowMs) as ClaimRow[];
  return rows.map(rowToClaim);
}

/**
 * The active working claim for an entity (at most one by uniqueness).
 * Returns null if none. The pty-inject-fanout / heads-down responder
 * walk reads this to decide whether to gate or skip.
 */
export function getActiveWorkingClaim(
  entity_kind: EntityKind,
  entity_id: string
): EntityClaim | null {
  const db = getIdentityDb();
  const nowMs = Date.now();
  const row = db.prepare(
    `SELECT * FROM entity_claims
     WHERE entity_kind = ? AND entity_id = ?
       AND claim_kind = 'working' AND status = 'active'
       AND (expires_at_ms IS NULL OR expires_at_ms > ?)
     LIMIT 1`
  ).get(entity_kind, entity_id, nowMs) as ClaimRow | undefined;
  return row ? rowToClaim(row) : null;
}

/**
 * Does this handle hold ANY active (non-expired) claim? The idle-trigger monitor
 * reads this as the "open work" signal: an agent with an active claim that has
 * gone idle gets the "push it forward or report blocked" nudge; one with no
 * claim gets "claim the next slice". Read-only.
 */
export function hasActiveClaimForHandle(handle: string): boolean {
  const db = getIdentityDb();
  const nowMs = Date.now();
  const row = db.prepare(
    `SELECT 1 FROM entity_claims
     WHERE claimed_by_handle = ? AND status = 'active'
       AND (expires_at_ms IS NULL OR expires_at_ms > ?)
     LIMIT 1`
  ).get(handle, nowMs);
  return row !== undefined;
}

export function listClaimsForRoomEntity(
  entityKind: EntityKind,
  entityIds: string[]
): EntityClaim[] {
  if (entityIds.length === 0) return [];
  const db = getIdentityDb();
  const nowMs = Date.now();
  const placeholders = entityIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM entity_claims
     WHERE entity_kind = ? AND status = 'active'
       AND entity_id IN (${placeholders})
       AND (expires_at_ms IS NULL OR expires_at_ms > ?)
     ORDER BY claimed_at_ms ASC`
  ).all(entityKind, ...entityIds, nowMs) as ClaimRow[];
  return rows.map(rowToClaim);
}

export function resetEntityClaimStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM entity_claims`).run();
}
