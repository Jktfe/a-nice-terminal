/**
 * humanConsentGrantsStore — backs the consent-gated impersonation slice
 * (plan_consent_gate_2026_05_20).
 *
 * Distinct from the existing topic-scoped `consent_grants` table (Lane A
 * research-consent). This store gates one specific question: can THIS
 * terminal post as THIS human owner right now?
 *
 * Lifecycle: active → consumed (uses_consumed++) → active OR exhausted;
 * or active → expired (TTL elapsed) OR revoked (explicit owner action).
 *
 * Every consumption writes an append-only audit row.
 */
import { randomUUID } from 'crypto';
import { getIdentityDb } from './db';

export type GrantStatus = 'active' | 'revoked' | 'expired' | 'exhausted';

export type HumanConsentGrant = {
  id: string;
  ownerId: string;
  grantedToTerminalId: string;
  grantedToHandle: string;
  maxUses: number | null;
  usesConsumed: number;
  status: GrantStatus;
  grantedAtMs: number;
  expiresAtMs: number | null;
  createdByTerminalId: string;
  revokedAtMs: number | null;
  revokedByHandle: string | null;
  updatedAtMs: number;
};

type GrantRow = {
  id: string;
  owner_id: string;
  granted_to_terminal_id: string;
  granted_to_handle: string;
  max_uses: number | null;
  uses_consumed: number;
  status: GrantStatus;
  granted_at_ms: number;
  expires_at_ms: number | null;
  created_by_terminal_id: string;
  revoked_at_ms: number | null;
  revoked_by_handle: string | null;
  updated_at_ms: number;
};

function makeGrantId(): string {
  return `gr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function makeAuditId(): string {
  return `ga_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function rowToGrant(row: GrantRow): HumanConsentGrant {
  return {
    id: row.id,
    ownerId: row.owner_id,
    grantedToTerminalId: row.granted_to_terminal_id,
    grantedToHandle: row.granted_to_handle,
    maxUses: row.max_uses,
    usesConsumed: row.uses_consumed,
    status: row.status,
    grantedAtMs: row.granted_at_ms,
    expiresAtMs: row.expires_at_ms,
    createdByTerminalId: row.created_by_terminal_id,
    revokedAtMs: row.revoked_at_ms,
    revokedByHandle: row.revoked_by_handle,
    updatedAtMs: row.updated_at_ms
  };
}

function writeAudit(input: {
  grantId: string;
  action: 'created' | 'consumed' | 'revoked' | 'expired' | 'exhausted';
  actorHandle?: string | null;
  actorTerminalId?: string | null;
  messageId?: string | null;
  occurredAtMs: number;
}): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO human_consent_grant_audit
        (id, grant_id, action, actor_handle, actor_terminal_id, message_id, occurred_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      makeAuditId(),
      input.grantId,
      input.action,
      input.actorHandle ?? null,
      input.actorTerminalId ?? null,
      input.messageId ?? null,
      input.occurredAtMs
    );
}

/**
 * Create a new active grant. The caller is expected to have already
 * verified the owner's password + TOTP code; this store assumes the
 * authorisation check was done upstream.
 */
export function createHumanConsentGrant(input: {
  ownerId: string;
  grantedToTerminalId: string;
  grantedToHandle: string;
  createdByTerminalId: string;
  durationMs: number | null;
  maxUses: number | null;
  nowMs?: number;
}): HumanConsentGrant {
  const now = input.nowMs ?? Date.now();
  const id = makeGrantId();
  const expiresAt = input.durationMs ? now + input.durationMs : null;
  const db = getIdentityDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO human_consent_grants
        (id, owner_id, granted_to_terminal_id, granted_to_handle,
         max_uses, uses_consumed, status, granted_at_ms, expires_at_ms,
         created_by_terminal_id, revoked_at_ms, revoked_by_handle, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, NULL, NULL, ?)`
    ).run(
      id,
      input.ownerId,
      input.grantedToTerminalId,
      input.grantedToHandle,
      input.maxUses,
      now,
      expiresAt,
      input.createdByTerminalId,
      now
    );
    writeAudit({
      grantId: id,
      action: 'created',
      actorTerminalId: input.createdByTerminalId,
      occurredAtMs: now
    });
  })();
  return findHumanConsentGrantById(id) as HumanConsentGrant;
}

export function findHumanConsentGrantById(id: string): HumanConsentGrant | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM human_consent_grants WHERE id = ?`)
    .get(id) as GrantRow | undefined;
  return row ? rowToGrant(row) : null;
}

/**
 * Find an active grant for (owner, terminal) — the lookup that the chat
 * write surfaces run on every human-handle write. Auto-expires any rows
 * whose TTL has elapsed before returning, so callers never see stale
 * 'active' rows.
 */
export function findActiveGrantForOwnerAndTerminal(input: {
  ownerId: string;
  grantedToTerminalId: string;
  nowMs?: number;
}): HumanConsentGrant | null {
  const now = input.nowMs ?? Date.now();
  expireStaleGrants(now);
  const row = getIdentityDb()
    .prepare(
      `SELECT * FROM human_consent_grants
       WHERE owner_id = ? AND granted_to_terminal_id = ? AND status = 'active'
       ORDER BY granted_at_ms DESC LIMIT 1`
    )
    .get(input.ownerId, input.grantedToTerminalId) as GrantRow | undefined;
  return row ? rowToGrant(row) : null;
}

/**
 * Consume one unit of an active grant. Atomic — uses_consumed++ then
 * status transition to 'exhausted' if max_uses reached. Writes audit
 * row referencing the message_id for traceability.
 *
 * Returns 'ok' on accept, 'expired'/'exhausted'/'revoked'/'unknown'
 * for the various failure paths.
 */
export function consumeHumanConsentGrant(input: {
  grantId: string;
  messageId: string;
  actorHandle: string;
  actorTerminalId: string;
  nowMs?: number;
}): 'ok' | 'expired' | 'exhausted' | 'revoked' | 'unknown' {
  const now = input.nowMs ?? Date.now();
  const db = getIdentityDb();
  let result: 'ok' | 'expired' | 'exhausted' | 'revoked' | 'unknown' = 'unknown';
  db.transaction(() => {
    const row = db
      .prepare(`SELECT * FROM human_consent_grants WHERE id = ?`)
      .get(input.grantId) as GrantRow | undefined;
    if (!row) return;
    // Already-terminal states get a clean return without writing audit
    // rows — the audit row was written at the transition; repeat callers
    // get the status read back, not a duplicate audit entry.
    if (row.status === 'revoked') { result = 'revoked'; return; }
    if (row.status === 'exhausted') { result = 'exhausted'; return; }
    if (row.status === 'expired') { result = 'expired'; return; }
    if (row.expires_at_ms !== null && row.expires_at_ms <= now) {
      db.prepare(
        `UPDATE human_consent_grants SET status = 'expired', updated_at_ms = ? WHERE id = ?`
      ).run(now, input.grantId);
      writeAudit({ grantId: input.grantId, action: 'expired', occurredAtMs: now });
      result = 'expired';
      return;
    }
    const newUses = row.uses_consumed + 1;
    const newStatus: GrantStatus =
      row.max_uses !== null && newUses >= row.max_uses ? 'exhausted' : 'active';
    db.prepare(
      `UPDATE human_consent_grants
       SET uses_consumed = ?, status = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(newUses, newStatus, now, input.grantId);
    writeAudit({
      grantId: input.grantId,
      action: 'consumed',
      actorHandle: input.actorHandle,
      actorTerminalId: input.actorTerminalId,
      messageId: input.messageId,
      occurredAtMs: now
    });
    if (newStatus === 'exhausted') {
      writeAudit({ grantId: input.grantId, action: 'exhausted', occurredAtMs: now });
    }
    result = 'ok';
  })();
  return result;
}

/**
 * Revoke an active grant. Idempotent — already-revoked rows are no-ops.
 */
export function revokeHumanConsentGrant(input: {
  grantId: string;
  revokedByHandle: string;
  nowMs?: number;
}): HumanConsentGrant | null {
  const now = input.nowMs ?? Date.now();
  const db = getIdentityDb();
  let result: HumanConsentGrant | null = null;
  db.transaction(() => {
    const row = db
      .prepare(`SELECT * FROM human_consent_grants WHERE id = ?`)
      .get(input.grantId) as GrantRow | undefined;
    if (!row) return;
    if (row.status !== 'active') {
      result = rowToGrant(row);
      return;
    }
    db.prepare(
      `UPDATE human_consent_grants
       SET status = 'revoked', revoked_at_ms = ?, revoked_by_handle = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(now, input.revokedByHandle, now, input.grantId);
    writeAudit({
      grantId: input.grantId,
      action: 'revoked',
      actorHandle: input.revokedByHandle,
      occurredAtMs: now
    });
    const refreshed = db
      .prepare(`SELECT * FROM human_consent_grants WHERE id = ?`)
      .get(input.grantId) as GrantRow;
    result = rowToGrant(refreshed);
  })();
  return result;
}

/**
 * Sweep expired grants in bulk. Called on read paths to keep
 * findActiveGrantForOwnerAndTerminal honest without a separate cron.
 */
function expireStaleGrants(nowMs: number): void {
  const db = getIdentityDb();
  const stale = db
    .prepare(
      `SELECT id FROM human_consent_grants
       WHERE status = 'active' AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?`
    )
    .all(nowMs) as { id: string }[];
  if (stale.length === 0) return;
  db.transaction(() => {
    const update = db.prepare(
      `UPDATE human_consent_grants SET status = 'expired', updated_at_ms = ? WHERE id = ?`
    );
    for (const row of stale) {
      update.run(nowMs, row.id);
      writeAudit({ grantId: row.id, action: 'expired', occurredAtMs: nowMs });
    }
  })();
}

/**
 * List grants for an owner — used by `ant grant list` to show the human
 * everything currently active under their identity.
 */
export function listGrantsForOwner(input: {
  ownerId: string;
  includeInactive?: boolean;
}): HumanConsentGrant[] {
  const rows = input.includeInactive
    ? (getIdentityDb()
        .prepare(`SELECT * FROM human_consent_grants WHERE owner_id = ? ORDER BY granted_at_ms DESC`)
        .all(input.ownerId) as GrantRow[])
    : (getIdentityDb()
        .prepare(
          `SELECT * FROM human_consent_grants WHERE owner_id = ? AND status = 'active' ORDER BY granted_at_ms DESC`
        )
        .all(input.ownerId) as GrantRow[]);
  return rows.map(rowToGrant);
}
