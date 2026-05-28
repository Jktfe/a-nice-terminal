/**
 * sourceSetsStore — per-org governed source-set registries for the
 * verification-v2 substrate. Slice 2 of the V2-server reframe.
 *
 * Backs the `source.reputable` verification protocol: a source is
 * "reputable" for a lens iff it (or its enclosing domain/repo/etc)
 * is a current member of a source-set that the lens references.
 *
 * **Key invariants**:
 *
 * 1. **Per-org ownership.** Every set has an `owner_org`. No ANT-shipped
 *    defaults — orgs build their own via the lens-creation skill
 *    (Slice 4) when they need regulatory-grounded sets.
 *
 * 2. **Append-only audit.** Approver changes, lifecycle transitions,
 *    review checkpoints, member add/remove — every governance action
 *    writes a `source_set_audit` row with mandatory actor_handle +
 *    actor_kind + reason. audit-of-flagger applies.
 *
 * 3. **Soft member-removal.** Removing a member doesn't drop the row;
 *    it sets `removed_at_ms` + `removed_by` + `removed_reason`. Supports
 *    historical queries ("what did this set contain at time T?").
 *    Hard-delete is forbidden.
 *
 * 4. **Lifecycle states.** `proposed → active → deprecated → withdrawn`.
 *    Withdrawn sets cannot be modified; deprecated sets can be restored.
 *
 * 5. **Scope kinds.**
 *    - `org-wide` — applies to any lens the org runs (default)
 *    - `lens-specific` — bound to a specific `bound_lens_id` (e.g. an
 *      FCA-PE-FO source set used only by that specific lens)
 *
 * Member kinds (per deck slide 5 ratification):
 *   - `domain` — e.g. "fca.org.uk"
 *   - `url` — specific article or filing URL
 *   - `repo` — github.com/org/repo
 *   - `file_collection` — Dropbox/iCloud folder reference
 *   - `named_person` — e.g. "Approved person on FCA's persons list"
 *   - `database` — e.g. Companies House registry
 *   - `named_document_set` — e.g. "NMVC board pack 2026 Q2"
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type SourceSetLifecycleState =
  | 'proposed'
  | 'active'
  | 'deprecated'
  | 'withdrawn';

export type SourceSetScopeKind = 'org-wide' | 'lens-specific';

export type SourceSetMemberKind =
  | 'domain'
  | 'url'
  | 'repo'
  | 'file_collection'
  | 'named_person'
  | 'database'
  | 'named_document_set';

export type SourceSetActorKind = 'human' | 'agent' | 'system';

export type SourceSetEventKind =
  | 'create'
  | 'rename'
  | 'add_approver'
  | 'remove_approver'
  | 'deprecate'
  | 'restore'
  | 'review_checkpoint'
  | 'add_member'
  | 'remove_member';

export type SourceSet = {
  id: string;
  name: string;
  description: string | null;
  ownerOrg: string;
  scopeKind: SourceSetScopeKind;
  boundLensId: string | null;
  approvers: string[];
  reviewCadenceMs: number | null;
  lifecycleState: SourceSetLifecycleState;
  createdBy: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastReviewedAtMs: number | null;
};

export type SourceSetMember = {
  id: string;
  setId: string;
  memberKind: SourceSetMemberKind;
  memberValue: string;
  label: string | null;
  addedBy: string;
  addedReason: string | null;
  addedAtMs: number;
  removedBy: string | null;
  removedReason: string | null;
  removedAtMs: number | null;
};

export type SourceSetAuditEntry = {
  id: string;
  setId: string;
  eventKind: SourceSetEventKind;
  actorHandle: string;
  actorKind: SourceSetActorKind;
  reason: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAtMs: number;
};

type SourceSetRow = {
  id: string;
  name: string;
  description: string | null;
  owner_org: string;
  scope_kind: string;
  bound_lens_id: string | null;
  approvers_json: string;
  review_cadence_ms: number | null;
  lifecycle_state: string;
  created_by: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_reviewed_at_ms: number | null;
};

type MemberRow = {
  id: string;
  set_id: string;
  member_kind: string;
  member_value: string;
  label: string | null;
  added_by: string;
  added_reason: string | null;
  added_at_ms: number;
  removed_by: string | null;
  removed_reason: string | null;
  removed_at_ms: number | null;
};

type AuditRow = {
  id: string;
  set_id: string;
  event_kind: string;
  actor_handle: string;
  actor_kind: string;
  reason: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at_ms: number;
};

function parseApprovers(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function rowToSet(row: SourceSetRow): SourceSet {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerOrg: row.owner_org,
    scopeKind: row.scope_kind as SourceSetScopeKind,
    boundLensId: row.bound_lens_id,
    approvers: parseApprovers(row.approvers_json),
    reviewCadenceMs: row.review_cadence_ms,
    lifecycleState: row.lifecycle_state as SourceSetLifecycleState,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastReviewedAtMs: row.last_reviewed_at_ms
  };
}

function rowToMember(row: MemberRow): SourceSetMember {
  return {
    id: row.id,
    setId: row.set_id,
    memberKind: row.member_kind as SourceSetMemberKind,
    memberValue: row.member_value,
    label: row.label,
    addedBy: row.added_by,
    addedReason: row.added_reason,
    addedAtMs: row.added_at_ms,
    removedBy: row.removed_by,
    removedReason: row.removed_reason,
    removedAtMs: row.removed_at_ms
  };
}

function rowToAudit(row: AuditRow): SourceSetAuditEntry {
  return {
    id: row.id,
    setId: row.set_id,
    eventKind: row.event_kind as SourceSetEventKind,
    actorHandle: row.actor_handle,
    actorKind: row.actor_kind as SourceSetActorKind,
    reason: row.reason,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    createdAtMs: row.created_at_ms
  };
}

export type CreateSourceSetInput = {
  id?: string; // optional — defaults to randomUUID
  name: string;
  description?: string | null;
  ownerOrg: string;
  scopeKind?: SourceSetScopeKind;
  boundLensId?: string | null;
  approvers?: string[];
  reviewCadenceMs?: number | null;
  initialLifecycleState?: SourceSetLifecycleState;
  createdBy: string;
  actorKind?: SourceSetActorKind;
  createReason?: string | null;
};

/**
 * Create a new source set + record a `create` audit event. Initial
 * lifecycle defaults to `active` (orgs creating their own sets don't
 * need a separate approval step; the create-action itself is the
 * approval, audited via actor_handle + reason).
 */
export function createSourceSet(input: CreateSourceSetInput): SourceSet {
  const db = getIdentityDb();
  const now = Date.now();
  const set: SourceSet = {
    id: input.id ?? randomUUID(),
    name: input.name,
    description: input.description ?? null,
    ownerOrg: input.ownerOrg,
    scopeKind: input.scopeKind ?? 'org-wide',
    boundLensId: input.boundLensId ?? null,
    approvers: input.approvers ?? [],
    reviewCadenceMs: input.reviewCadenceMs ?? null,
    lifecycleState: input.initialLifecycleState ?? 'active',
    createdBy: input.createdBy,
    createdAtMs: now,
    updatedAtMs: now,
    lastReviewedAtMs: null
  };
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO source_sets
        (id, name, description, owner_org, scope_kind, bound_lens_id,
         approvers_json, review_cadence_ms, lifecycle_state,
         created_by, created_at_ms, updated_at_ms, last_reviewed_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      set.id,
      set.name,
      set.description,
      set.ownerOrg,
      set.scopeKind,
      set.boundLensId,
      JSON.stringify(set.approvers),
      set.reviewCadenceMs,
      set.lifecycleState,
      set.createdBy,
      set.createdAtMs,
      set.updatedAtMs,
      set.lastReviewedAtMs
    );
    recordSourceSetEvent({
      setId: set.id,
      eventKind: 'create',
      actorHandle: set.createdBy,
      actorKind: input.actorKind ?? 'human',
      reason: input.createReason ?? null,
      beforeJson: null,
      afterJson: JSON.stringify(set)
    });
  });
  txn();
  return set;
}

export type UpdateSourceSetInput = {
  id: string;
  name?: string;
  description?: string | null;
  approvers?: string[];
  reviewCadenceMs?: number | null;
  actorHandle: string;
  actorKind?: SourceSetActorKind;
  reason?: string | null;
};

/**
 * Update set metadata (name / description / approvers / review cadence).
 * Lifecycle transitions go through `deprecateSourceSet` / `restoreSourceSet`
 * instead so the audit event names the right action.
 *
 * Returns null if the set doesn't exist or is `withdrawn` (terminal state).
 */
export function updateSourceSet(input: UpdateSourceSetInput): SourceSet | null {
  const db = getIdentityDb();
  const existing = getSourceSet(input.id);
  if (!existing) return null;
  if (existing.lifecycleState === 'withdrawn') return null;
  const now = Date.now();
  const next: SourceSet = {
    ...existing,
    name: input.name !== undefined ? input.name : existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    approvers: input.approvers !== undefined ? input.approvers : existing.approvers,
    reviewCadenceMs:
      input.reviewCadenceMs !== undefined ? input.reviewCadenceMs : existing.reviewCadenceMs,
    updatedAtMs: now
  };
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE source_sets
         SET name = ?, description = ?, approvers_json = ?,
             review_cadence_ms = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(
      next.name,
      next.description,
      JSON.stringify(next.approvers),
      next.reviewCadenceMs,
      next.updatedAtMs,
      next.id
    );
    // Decide event kind based on what actually changed. Approver list
    // edits are the most audit-sensitive — surface them as
    // add_approver / remove_approver events rather than a generic
    // rename.
    if (input.name !== undefined && input.name !== existing.name) {
      recordSourceSetEvent({
        setId: next.id,
        eventKind: 'rename',
        actorHandle: input.actorHandle,
        actorKind: input.actorKind ?? 'human',
        reason: input.reason ?? null,
        beforeJson: JSON.stringify({ name: existing.name }),
        afterJson: JSON.stringify({ name: next.name })
      });
    }
    if (input.approvers !== undefined) {
      const added = input.approvers.filter((h) => !existing.approvers.includes(h));
      const removed = existing.approvers.filter((h) => !input.approvers!.includes(h));
      for (const h of added) {
        recordSourceSetEvent({
          setId: next.id,
          eventKind: 'add_approver',
          actorHandle: input.actorHandle,
          actorKind: input.actorKind ?? 'human',
          reason: input.reason ?? null,
          beforeJson: null,
          afterJson: JSON.stringify({ approver: h })
        });
      }
      for (const h of removed) {
        recordSourceSetEvent({
          setId: next.id,
          eventKind: 'remove_approver',
          actorHandle: input.actorHandle,
          actorKind: input.actorKind ?? 'human',
          reason: input.reason ?? null,
          beforeJson: JSON.stringify({ approver: h }),
          afterJson: null
        });
      }
    }
  });
  txn();
  return next;
}

/**
 * Mark a source set deprecated. Members remain queryable; new members
 * cannot be added (caller-layer enforcement). Restorable via
 * `restoreSourceSet`.
 */
export function deprecateSourceSet(input: {
  id: string;
  actorHandle: string;
  actorKind?: SourceSetActorKind;
  reason?: string | null;
}): SourceSet | null {
  const db = getIdentityDb();
  const existing = getSourceSet(input.id);
  if (!existing) return null;
  if (existing.lifecycleState !== 'active') return existing;
  const now = Date.now();
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE source_sets SET lifecycle_state = 'deprecated', updated_at_ms = ? WHERE id = ?`
    ).run(now, input.id);
    recordSourceSetEvent({
      setId: input.id,
      eventKind: 'deprecate',
      actorHandle: input.actorHandle,
      actorKind: input.actorKind ?? 'human',
      reason: input.reason ?? null,
      beforeJson: JSON.stringify({ lifecycleState: existing.lifecycleState }),
      afterJson: JSON.stringify({ lifecycleState: 'deprecated' })
    });
  });
  txn();
  return { ...existing, lifecycleState: 'deprecated', updatedAtMs: now };
}

export function restoreSourceSet(input: {
  id: string;
  actorHandle: string;
  actorKind?: SourceSetActorKind;
  reason?: string | null;
}): SourceSet | null {
  const db = getIdentityDb();
  const existing = getSourceSet(input.id);
  if (!existing) return null;
  if (existing.lifecycleState !== 'deprecated') return existing;
  const now = Date.now();
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE source_sets SET lifecycle_state = 'active', updated_at_ms = ? WHERE id = ?`
    ).run(now, input.id);
    recordSourceSetEvent({
      setId: input.id,
      eventKind: 'restore',
      actorHandle: input.actorHandle,
      actorKind: input.actorKind ?? 'human',
      reason: input.reason ?? null,
      beforeJson: JSON.stringify({ lifecycleState: 'deprecated' }),
      afterJson: JSON.stringify({ lifecycleState: 'active' })
    });
  });
  txn();
  return { ...existing, lifecycleState: 'active', updatedAtMs: now };
}

/**
 * Record a review checkpoint — the approver(s) have re-validated the
 * set's contents against the current org/regulatory state. Bumps
 * `last_reviewed_at_ms` and writes an audit event.
 */
export function recordReviewCheckpoint(input: {
  id: string;
  actorHandle: string;
  actorKind?: SourceSetActorKind;
  reason?: string | null;
}): SourceSet | null {
  const db = getIdentityDb();
  const existing = getSourceSet(input.id);
  if (!existing) return null;
  const now = Date.now();
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE source_sets SET last_reviewed_at_ms = ?, updated_at_ms = ? WHERE id = ?`
    ).run(now, now, input.id);
    recordSourceSetEvent({
      setId: input.id,
      eventKind: 'review_checkpoint',
      actorHandle: input.actorHandle,
      actorKind: input.actorKind ?? 'human',
      reason: input.reason ?? null,
      beforeJson: JSON.stringify({ lastReviewedAtMs: existing.lastReviewedAtMs }),
      afterJson: JSON.stringify({ lastReviewedAtMs: now })
    });
  });
  txn();
  return { ...existing, lastReviewedAtMs: now, updatedAtMs: now };
}

export function getSourceSet(id: string): SourceSet | null {
  const db = getIdentityDb();
  const row = db
    .prepare('SELECT * FROM source_sets WHERE id = ?')
    .get(id) as SourceSetRow | undefined;
  return row ? rowToSet(row) : null;
}

export type ListSourceSetsOptions = {
  ownerOrg?: string;
  scopeKind?: SourceSetScopeKind;
  boundLensId?: string;
  lifecycleStates?: SourceSetLifecycleState[];
};

export function listSourceSets(options: ListSourceSetsOptions = {}): SourceSet[] {
  const db = getIdentityDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.ownerOrg) {
    conditions.push('owner_org = ?');
    params.push(options.ownerOrg);
  }
  if (options.scopeKind) {
    conditions.push('scope_kind = ?');
    params.push(options.scopeKind);
  }
  if (options.boundLensId) {
    conditions.push('bound_lens_id = ?');
    params.push(options.boundLensId);
  }
  if (options.lifecycleStates && options.lifecycleStates.length > 0) {
    const placeholders = options.lifecycleStates.map(() => '?').join(', ');
    conditions.push(`lifecycle_state IN (${placeholders})`);
    params.push(...options.lifecycleStates);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM source_sets ${whereClause} ORDER BY created_at_ms DESC`)
    .all(...params) as SourceSetRow[];
  return rows.map(rowToSet);
}

// ── Members ─────────────────────────────────────────────────────────

export type AddSourceSetMemberInput = {
  setId: string;
  memberKind: SourceSetMemberKind;
  memberValue: string;
  label?: string | null;
  addedBy: string;
  addedReason?: string | null;
  actorKind?: SourceSetActorKind;
};

/**
 * Add a member to a source set. Records both the member row and an
 * `add_member` audit event. Idempotent on (set_id, member_kind,
 * member_value) for ACTIVE rows — adding the same value twice returns
 * the existing active row instead of creating a duplicate.
 */
export function addMember(input: AddSourceSetMemberInput): SourceSetMember {
  const db = getIdentityDb();
  // Idempotency check: if the same value is already active in this
  // set, return the existing row. This prevents accidental duplicates
  // and keeps the audit trail honest (no spurious add events).
  const existing = db
    .prepare(
      `SELECT * FROM source_set_members
        WHERE set_id = ? AND member_kind = ? AND member_value = ?
          AND removed_at_ms IS NULL
        LIMIT 1`
    )
    .get(input.setId, input.memberKind, input.memberValue) as MemberRow | undefined;
  if (existing) return rowToMember(existing);
  const now = Date.now();
  const member: SourceSetMember = {
    id: randomUUID(),
    setId: input.setId,
    memberKind: input.memberKind,
    memberValue: input.memberValue,
    label: input.label ?? null,
    addedBy: input.addedBy,
    addedReason: input.addedReason ?? null,
    addedAtMs: now,
    removedBy: null,
    removedReason: null,
    removedAtMs: null
  };
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO source_set_members
        (id, set_id, member_kind, member_value, label,
         added_by, added_reason, added_at_ms,
         removed_by, removed_reason, removed_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      member.id,
      member.setId,
      member.memberKind,
      member.memberValue,
      member.label,
      member.addedBy,
      member.addedReason,
      member.addedAtMs,
      null,
      null,
      null
    );
    recordSourceSetEvent({
      setId: input.setId,
      eventKind: 'add_member',
      actorHandle: input.addedBy,
      actorKind: input.actorKind ?? 'human',
      reason: input.addedReason ?? null,
      beforeJson: null,
      afterJson: JSON.stringify({
        memberKind: input.memberKind,
        memberValue: input.memberValue,
        label: input.label ?? null
      })
    });
  });
  txn();
  return member;
}

/**
 * Soft-remove a member (sets `removed_at_ms`). The row remains
 * queryable for historical reads. Returns the updated member, or
 * null if the member doesn't exist or is already removed.
 */
export function removeMember(input: {
  memberId: string;
  removedBy: string;
  removedReason?: string | null;
  actorKind?: SourceSetActorKind;
}): SourceSetMember | null {
  const db = getIdentityDb();
  const existing = db
    .prepare('SELECT * FROM source_set_members WHERE id = ?')
    .get(input.memberId) as MemberRow | undefined;
  if (!existing) return null;
  if (existing.removed_at_ms !== null) return rowToMember(existing);
  const now = Date.now();
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE source_set_members
         SET removed_by = ?, removed_reason = ?, removed_at_ms = ?
       WHERE id = ?`
    ).run(input.removedBy, input.removedReason ?? null, now, input.memberId);
    recordSourceSetEvent({
      setId: existing.set_id,
      eventKind: 'remove_member',
      actorHandle: input.removedBy,
      actorKind: input.actorKind ?? 'human',
      reason: input.removedReason ?? null,
      beforeJson: JSON.stringify({
        memberKind: existing.member_kind,
        memberValue: existing.member_value
      }),
      afterJson: null
    });
  });
  txn();
  return {
    ...rowToMember(existing),
    removedBy: input.removedBy,
    removedReason: input.removedReason ?? null,
    removedAtMs: now
  };
}

export type ListMembersOptions = {
  includeRemoved?: boolean;
  memberKind?: SourceSetMemberKind;
};

export function listMembersForSet(
  setId: string,
  options: ListMembersOptions = {}
): SourceSetMember[] {
  const db = getIdentityDb();
  const conditions: string[] = ['set_id = ?'];
  const params: Array<string | number> = [setId];
  if (!options.includeRemoved) {
    conditions.push('removed_at_ms IS NULL');
  }
  if (options.memberKind) {
    conditions.push('member_kind = ?');
    params.push(options.memberKind);
  }
  const rows = db
    .prepare(
      `SELECT * FROM source_set_members
        WHERE ${conditions.join(' AND ')}
        ORDER BY added_at_ms ASC`
    )
    .all(...params) as MemberRow[];
  return rows.map(rowToMember);
}

/**
 * Find sets containing a specific member value. Used by the
 * verification flow to check whether a source URL/domain/etc is
 * currently in a set the lens references.
 */
export function findSetsContaining(input: {
  memberKind: SourceSetMemberKind;
  memberValue: string;
  ownerOrg?: string;
  includeRemoved?: boolean;
}): Array<{ set: SourceSet; member: SourceSetMember }> {
  const db = getIdentityDb();
  const conditions: string[] = ['m.member_kind = ?', 'm.member_value = ?'];
  const params: Array<string | number> = [input.memberKind, input.memberValue];
  if (!input.includeRemoved) {
    conditions.push('m.removed_at_ms IS NULL');
  }
  if (input.ownerOrg) {
    conditions.push('s.owner_org = ?');
    params.push(input.ownerOrg);
  }
  const rows = db
    .prepare(
      `SELECT s.*, m.id AS member_id, m.member_kind AS m_kind, m.member_value AS m_value,
              m.label AS m_label, m.added_by AS m_added_by, m.added_reason AS m_added_reason,
              m.added_at_ms AS m_added_at, m.removed_by AS m_removed_by,
              m.removed_reason AS m_removed_reason, m.removed_at_ms AS m_removed_at
         FROM source_set_members m
         JOIN source_sets s ON s.id = m.set_id
        WHERE ${conditions.join(' AND ')}`
    )
    .all(...params) as Array<SourceSetRow & {
      member_id: string;
      m_kind: string;
      m_value: string;
      m_label: string | null;
      m_added_by: string;
      m_added_reason: string | null;
      m_added_at: number;
      m_removed_by: string | null;
      m_removed_reason: string | null;
      m_removed_at: number | null;
    }>;
  return rows.map((r) => ({
    set: rowToSet({
      id: r.id,
      name: r.name,
      description: r.description,
      owner_org: r.owner_org,
      scope_kind: r.scope_kind,
      bound_lens_id: r.bound_lens_id,
      approvers_json: r.approvers_json,
      review_cadence_ms: r.review_cadence_ms,
      lifecycle_state: r.lifecycle_state,
      created_by: r.created_by,
      created_at_ms: r.created_at_ms,
      updated_at_ms: r.updated_at_ms,
      last_reviewed_at_ms: r.last_reviewed_at_ms
    }),
    member: rowToMember({
      id: r.member_id,
      set_id: r.id,
      member_kind: r.m_kind,
      member_value: r.m_value,
      label: r.m_label,
      added_by: r.m_added_by,
      added_reason: r.m_added_reason,
      added_at_ms: r.m_added_at,
      removed_by: r.m_removed_by,
      removed_reason: r.m_removed_reason,
      removed_at_ms: r.m_removed_at
    })
  }));
}

// ── Audit log ───────────────────────────────────────────────────────

export function recordSourceSetEvent(input: {
  setId: string;
  eventKind: SourceSetEventKind;
  actorHandle: string;
  actorKind: SourceSetActorKind;
  reason: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
}): SourceSetAuditEntry {
  const db = getIdentityDb();
  const entry: SourceSetAuditEntry = {
    id: randomUUID(),
    setId: input.setId,
    eventKind: input.eventKind,
    actorHandle: input.actorHandle,
    actorKind: input.actorKind,
    reason: input.reason,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    createdAtMs: Date.now()
  };
  db.prepare(
    `INSERT INTO source_set_audit
      (id, set_id, event_kind, actor_handle, actor_kind, reason,
       before_json, after_json, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    entry.setId,
    entry.eventKind,
    entry.actorHandle,
    entry.actorKind,
    entry.reason,
    entry.beforeJson,
    entry.afterJson,
    entry.createdAtMs
  );
  return entry;
}

export function listAuditForSet(setId: string): SourceSetAuditEntry[] {
  const db = getIdentityDb();
  // Newest first, tie-break by rowid (same pattern as
  // verificationTaxonomyStore — same-ms events keep causal order).
  const rows = db
    .prepare(
      `SELECT * FROM source_set_audit
        WHERE set_id = ?
        ORDER BY created_at_ms DESC, rowid DESC`
    )
    .all(setId) as AuditRow[];
  return rows.map(rowToAudit);
}

export function resetSourceSetsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM source_set_audit').run();
  db.prepare('DELETE FROM source_set_members').run();
  db.prepare('DELETE FROM source_sets').run();
}
