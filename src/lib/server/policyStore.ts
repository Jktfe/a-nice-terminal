/**
 * policyStore — verification policy catalogue + append-only audit trail.
 *
 * Phase A.5 of the v4 verification subsystem (JWPK ratified 2026-05-17).
 *
 * Contract:
 *   - Policies are global. Anyone can list public ones. owner_handle is
 *     provenance — edit/delete is owner-gated at the API layer, not here.
 *     This store trusts its `actorHandle` argument; routes are responsible
 *     for matching it to the resolved identity.
 *   - Every mutating call (create / update / softDelete / restore / clone)
 *     writes a row into verification_policy_audit IN THE SAME TRANSACTION
 *     as the policy mutation. There is no API for editing audit rows.
 *   - actor_kind is supplied by the caller — the route knows whether the
 *     identity came from a browser session (human) or pidChain (agent).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type PolicyVisibility = 'public' | 'unlisted' | 'private';
export type PolicyActorKind = 'human' | 'agent';
export type PolicyAuditAction =
  | 'create'
  | 'update'
  | 'soft_delete'
  | 'restore'
  | 'clone_source'
  | 'clone_target'
  | 'visibility_change';

/**
 * The policy body is intentionally loose — block-kinds and requirement
 * shape are still being authored (JWPK explicitly said his own canonical
 * one isn't designed yet). The store just persists the JSON; downstream
 * verifiers parse it. Strawman shape used by the UI:
 *   { blocks: { external_link: { agents: 2, verifyLive: true }, ... },
 *     fallback: { humans: 1 } }
 */
export type PolicyBody = Record<string, unknown>;

export type Policy = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ownerHandle: string;
  policy: PolicyBody;
  visibility: PolicyVisibility;
  createdAtMs: number;
  updatedAtMs: number | null;
  deletedAtMs: number | null;
};

export type PolicyAuditEntry = {
  id: string;
  policyId: string;
  actorHandle: string;
  actorKind: PolicyActorKind;
  action: PolicyAuditAction;
  before: PolicyBody | null;
  after: PolicyBody | null;
  reason: string | null;
  createdAtMs: number;
};

type PolicyRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  owner_handle: string;
  policy_json: string;
  visibility: PolicyVisibility;
  created_at_ms: number;
  updated_at_ms: number | null;
  deleted_at_ms: number | null;
};

type AuditRow = {
  id: string;
  policy_id: string;
  actor_handle: string;
  actor_kind: PolicyActorKind;
  action: PolicyAuditAction;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  created_at_ms: number;
};

function rowToPolicy(row: PolicyRow): Policy {
  let parsed: PolicyBody = {};
  try {
    const candidate = JSON.parse(row.policy_json) as unknown;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as PolicyBody;
    }
  } catch {
    /* malformed json — treat as empty rather than throw */
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    ownerHandle: row.owner_handle,
    policy: parsed,
    visibility: row.visibility,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    deletedAtMs: row.deleted_at_ms
  };
}

function rowToAuditEntry(row: AuditRow): PolicyAuditEntry {
  const parse = (raw: string | null): PolicyBody | null => {
    if (raw === null) return null;
    try {
      const c = JSON.parse(raw) as unknown;
      if (c && typeof c === 'object' && !Array.isArray(c)) return c as PolicyBody;
    } catch {
      /* malformed */
    }
    return null;
  };
  return {
    id: row.id,
    policyId: row.policy_id,
    actorHandle: row.actor_handle,
    actorKind: row.actor_kind,
    action: row.action,
    before: parse(row.before_json),
    after: parse(row.after_json),
    reason: row.reason,
    createdAtMs: row.created_at_ms
  };
}

/** Normalise a human-readable name into a url-safe slug. */
export function slugifyPolicyName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function ensureUniqueSlug(base: string): string {
  const db = getIdentityDb();
  let candidate = base.length > 0 ? base : 'policy';
  let counter = 1;
  while (true) {
    const row = db
      .prepare('SELECT 1 AS present FROM verification_policies WHERE slug = ?')
      .get(candidate) as { present: number } | undefined;
    if (!row) return candidate;
    counter += 1;
    candidate = `${base}-${counter}`;
  }
}

export function listPublicPolicies(options?: {
  ownerHandle?: string;
  includeDeleted?: boolean;
}): Policy[] {
  const db = getIdentityDb();
  const clauses: string[] = ['visibility = ?'];
  const args: unknown[] = ['public'];
  if (!options?.includeDeleted) clauses.push('deleted_at_ms IS NULL');
  if (options?.ownerHandle) {
    clauses.push('owner_handle = ?');
    args.push(options.ownerHandle);
  }
  const rows = db
    .prepare(
      `SELECT * FROM verification_policies WHERE ${clauses.join(' AND ')} ORDER BY updated_at_ms DESC, created_at_ms DESC`
    )
    .all(...args) as PolicyRow[];
  return rows.map(rowToPolicy);
}

export function listPoliciesOwnedBy(ownerHandle: string): Policy[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      'SELECT * FROM verification_policies WHERE owner_handle = ? AND deleted_at_ms IS NULL ORDER BY updated_at_ms DESC, created_at_ms DESC'
    )
    .all(ownerHandle) as PolicyRow[];
  return rows.map(rowToPolicy);
}

export function getPolicyBySlug(slug: string): Policy | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare('SELECT * FROM verification_policies WHERE slug = ?')
    .get(slug) as PolicyRow | undefined;
  return row ? rowToPolicy(row) : undefined;
}

export function getPolicyById(id: string): Policy | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare('SELECT * FROM verification_policies WHERE id = ?')
    .get(id) as PolicyRow | undefined;
  return row ? rowToPolicy(row) : undefined;
}

export function listAuditForPolicy(policyId: string): PolicyAuditEntry[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      'SELECT * FROM verification_policy_audit WHERE policy_id = ? ORDER BY created_at_ms DESC'
    )
    .all(policyId) as AuditRow[];
  return rows.map(rowToAuditEntry);
}

export type CreatePolicyInput = {
  name: string;
  description?: string | null;
  ownerHandle: string;
  actorKind: PolicyActorKind;
  policy: PolicyBody;
  visibility?: PolicyVisibility;
  reason?: string | null;
  nowMs?: number;
};

export function createPolicy(input: CreatePolicyInput): Policy {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) throw new Error('Policy name cannot be blank.');
  if (!input.ownerHandle.trim()) throw new Error('Policy owner_handle is required.');

  const db = getIdentityDb();
  const id = randomUUID();
  const slug = ensureUniqueSlug(slugifyPolicyName(trimmedName));
  const nowMs = input.nowMs ?? Date.now();
  const visibility = input.visibility ?? 'public';
  const policyJson = JSON.stringify(input.policy);

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO verification_policies
        (id, slug, name, description, owner_handle, policy_json, visibility, created_at_ms, updated_at_ms, deleted_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run(id, slug, trimmedName, input.description ?? null, input.ownerHandle, policyJson, visibility, nowMs);

    db.prepare(
      `INSERT INTO verification_policy_audit
        (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
       VALUES (?, ?, ?, ?, 'create', NULL, ?, ?, ?)`
    ).run(
      randomUUID(),
      id,
      input.ownerHandle,
      input.actorKind,
      policyJson,
      input.reason ?? null,
      nowMs
    );
  });
  txn();

  return rowToPolicy(
    db.prepare('SELECT * FROM verification_policies WHERE id = ?').get(id) as PolicyRow
  );
}

export type UpdatePolicyInput = {
  slug: string;
  actorHandle: string;
  actorKind: PolicyActorKind;
  name?: string;
  description?: string | null;
  policy?: PolicyBody;
  visibility?: PolicyVisibility;
  reason?: string | null;
  nowMs?: number;
};

export function updatePolicy(input: UpdatePolicyInput): Policy | undefined {
  const db = getIdentityDb();
  const existing = getPolicyBySlug(input.slug);
  if (!existing || existing.deletedAtMs !== null) return undefined;

  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  const nextDescription = input.description !== undefined ? input.description : existing.description;
  const nextPolicy = input.policy !== undefined ? input.policy : existing.policy;
  const nextVisibility = input.visibility ?? existing.visibility;
  const nowMs = input.nowMs ?? Date.now();
  const beforeJson = JSON.stringify(existing.policy);
  const afterJson = JSON.stringify(nextPolicy);

  const visibilityChanged = nextVisibility !== existing.visibility;

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE verification_policies
        SET name = ?, description = ?, policy_json = ?, visibility = ?, updated_at_ms = ?
        WHERE id = ?`
    ).run(nextName, nextDescription, afterJson, nextVisibility, nowMs, existing.id);

    db.prepare(
      `INSERT INTO verification_policy_audit
        (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
       VALUES (?, ?, ?, ?, 'update', ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      existing.id,
      input.actorHandle,
      input.actorKind,
      beforeJson,
      afterJson,
      input.reason ?? null,
      nowMs
    );

    if (visibilityChanged) {
      db.prepare(
        `INSERT INTO verification_policy_audit
          (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
         VALUES (?, ?, ?, ?, 'visibility_change', ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        existing.id,
        input.actorHandle,
        input.actorKind,
        JSON.stringify({ visibility: existing.visibility }),
        JSON.stringify({ visibility: nextVisibility }),
        input.reason ?? null,
        nowMs + 1 // tiny offset so DESC ordering shows update + visibility together
      );
    }
  });
  txn();

  return rowToPolicy(
    db.prepare('SELECT * FROM verification_policies WHERE id = ?').get(existing.id) as PolicyRow
  );
}

export function softDeletePolicy(
  slug: string,
  actorHandle: string,
  actorKind: PolicyActorKind,
  reason: string | null = null,
  nowMs: number = Date.now()
): boolean {
  const db = getIdentityDb();
  const existing = getPolicyBySlug(slug);
  if (!existing || existing.deletedAtMs !== null) return false;

  const beforeJson = JSON.stringify(existing.policy);
  const txn = db.transaction(() => {
    db.prepare(
      'UPDATE verification_policies SET deleted_at_ms = ?, updated_at_ms = ? WHERE id = ?'
    ).run(nowMs, nowMs, existing.id);

    db.prepare(
      `INSERT INTO verification_policy_audit
        (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
       VALUES (?, ?, ?, ?, 'soft_delete', ?, NULL, ?, ?)`
    ).run(randomUUID(), existing.id, actorHandle, actorKind, beforeJson, reason, nowMs);
  });
  txn();
  return true;
}

export function restorePolicy(
  slug: string,
  actorHandle: string,
  actorKind: PolicyActorKind,
  reason: string | null = null,
  nowMs: number = Date.now()
): boolean {
  const db = getIdentityDb();
  const existing = getPolicyBySlug(slug);
  if (!existing || existing.deletedAtMs === null) return false;

  const afterJson = JSON.stringify(existing.policy);
  const txn = db.transaction(() => {
    db.prepare(
      'UPDATE verification_policies SET deleted_at_ms = NULL, updated_at_ms = ? WHERE id = ?'
    ).run(nowMs, existing.id);

    db.prepare(
      `INSERT INTO verification_policy_audit
        (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
       VALUES (?, ?, ?, ?, 'restore', NULL, ?, ?, ?)`
    ).run(randomUUID(), existing.id, actorHandle, actorKind, afterJson, reason, nowMs);
  });
  txn();
  return true;
}

export type ClonePolicyInput = {
  sourceSlug: string;
  newName: string;
  newOwnerHandle: string;
  actorKind: PolicyActorKind;
  visibility?: PolicyVisibility;
  reason?: string | null;
  nowMs?: number;
};

export function clonePolicy(input: ClonePolicyInput): Policy | undefined {
  const db = getIdentityDb();
  const source = getPolicyBySlug(input.sourceSlug);
  if (!source || source.deletedAtMs !== null) return undefined;

  const nowMs = input.nowMs ?? Date.now();
  const sourcePolicyJson = JSON.stringify(source.policy);

  // We need to atomically: create the target row, audit the source ('clone_source'),
  // and audit the target ('clone_target'). Do all three inside one transaction.
  const targetId = randomUUID();
  const targetSlug = ensureUniqueSlug(slugifyPolicyName(input.newName));
  const trimmedName = input.newName.trim();
  const visibility = input.visibility ?? 'public';

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO verification_policies
        (id, slug, name, description, owner_handle, policy_json, visibility, created_at_ms, updated_at_ms, deleted_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run(
      targetId,
      targetSlug,
      trimmedName,
      source.description,
      input.newOwnerHandle,
      sourcePolicyJson,
      visibility,
      nowMs
    );

    // Source-side audit (someone forked us).
    db.prepare(
      `INSERT INTO verification_policy_audit
        (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
       VALUES (?, ?, ?, ?, 'clone_source', NULL, ?, ?, ?)`
    ).run(
      randomUUID(),
      source.id,
      input.newOwnerHandle,
      input.actorKind,
      JSON.stringify({ clonedTo: targetId, clonedToSlug: targetSlug }),
      input.reason ?? null,
      nowMs
    );

    // Target-side audit (this row was born as a clone of X).
    db.prepare(
      `INSERT INTO verification_policy_audit
        (id, policy_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
       VALUES (?, ?, ?, ?, 'clone_target', ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      targetId,
      input.newOwnerHandle,
      input.actorKind,
      JSON.stringify({ clonedFrom: source.id, clonedFromSlug: source.slug }),
      sourcePolicyJson,
      input.reason ?? null,
      nowMs
    );
  });
  txn();

  return getPolicyById(targetId);
}

export function resetPolicyStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM verification_policy_audit').run();
  db.prepare('DELETE FROM verification_policies').run();
}
