/**
 * orgsStore — license-time org namespace provisioning substrate.
 *
 * F1 of the verification-v2 substrate. When a license is purchased on
 * antonline.dev, the org's namespace (`org.<orgId>.*`) is registered
 * here and the license-holder is granted org-admin. Downstream tag /
 * source-set / lens creation gates on these rows.
 *
 * **Key invariants**:
 *
 * 1. **Namespace uniqueness.** `namespace_prefix` is UNIQUE — two orgs
 *    cannot share the same `org.<orgId>` prefix. The DB enforces this
 *    via UNIQUE INDEX; the store maps the constraint violation onto a
 *    readable error.
 *
 * 2. **Soft-archive only.** Orgs are archived (`archived_at_ms` set),
 *    never hard-deleted — historical verifications + tag applications
 *    keep resolving against their owning namespace. `org_admins` is
 *    soft-deleted via `revoked_at_ms` for the same reason.
 *
 * 3. **Tier is mutable.** A license upgrade flips `oss → premium →
 *    enterprise` without losing the namespace registration. See
 *    `setOrgTier`.
 *
 * 4. **Idempotent admin assignment.** `assignOrgAdmin` returns the
 *    existing ACTIVE row if (org_id, handle) already has one. The
 *    partial UNIQUE index permits re-grant after revocation.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type OrgTier = 'oss' | 'premium' | 'enterprise';

export type Org = {
  id: string;
  displayName: string;
  namespacePrefix: string;
  tier: OrgTier;
  createdBy: string;
  createdAtMs: number;
  archivedAtMs: number | null;
};

export type OrgAdmin = {
  id: string;
  orgId: string;
  handle: string;
  assignedBy: string;
  assignedAtMs: number;
  revokedAtMs: number | null;
  revokedBy: string | null;
};

type OrgRow = {
  id: string;
  display_name: string;
  namespace_prefix: string;
  tier: string;
  created_by: string;
  created_at_ms: number;
  archived_at_ms: number | null;
};

type OrgAdminRow = {
  id: string;
  org_id: string;
  handle: string;
  assigned_by: string;
  assigned_at_ms: number;
  revoked_at_ms: number | null;
  revoked_by: string | null;
};

function rowToOrg(row: OrgRow): Org {
  return {
    id: row.id,
    displayName: row.display_name,
    namespacePrefix: row.namespace_prefix,
    tier: row.tier as OrgTier,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms,
    archivedAtMs: row.archived_at_ms
  };
}

function rowToAdmin(row: OrgAdminRow): OrgAdmin {
  return {
    id: row.id,
    orgId: row.org_id,
    handle: row.handle,
    assignedBy: row.assigned_by,
    assignedAtMs: row.assigned_at_ms,
    revokedAtMs: row.revoked_at_ms,
    revokedBy: row.revoked_by
  };
}

export type CreateOrgInput = {
  id: string;
  displayName: string;
  namespacePrefix: string;
  tier?: OrgTier;
  createdBy: string;
};

/**
 * Register a new org + namespace. Throws if `id` or `namespace_prefix`
 * is already in use (the UNIQUE index on namespace_prefix surfaces as
 * a SQLITE_CONSTRAINT — we catch it and rethrow with a readable message).
 */
export function createOrg(input: CreateOrgInput): Org {
  const db = getIdentityDb();
  const now = Date.now();
  const org: Org = {
    id: input.id,
    displayName: input.displayName,
    namespacePrefix: input.namespacePrefix,
    tier: input.tier ?? 'oss',
    createdBy: input.createdBy,
    createdAtMs: now,
    archivedAtMs: null
  };
  try {
    db.prepare(
      `INSERT INTO orgs
        (id, display_name, namespace_prefix, tier, created_by,
         created_at_ms, archived_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      org.id,
      org.displayName,
      org.namespacePrefix,
      org.tier,
      org.createdBy,
      org.createdAtMs,
      org.archivedAtMs
    );
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('UNIQUE') && msg.includes('namespace_prefix')) {
      throw new Error(`Namespace prefix ${input.namespacePrefix} is already registered.`);
    }
    if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
      throw new Error(`Org ${input.id} already exists.`);
    }
    throw cause;
  }
  return org;
}

export function getOrg(id: string): Org | null {
  const db = getIdentityDb();
  const row = db
    .prepare('SELECT * FROM orgs WHERE id = ?')
    .get(id) as OrgRow | undefined;
  return row ? rowToOrg(row) : null;
}

export function getOrgByNamespacePrefix(prefix: string): Org | null {
  const db = getIdentityDb();
  const row = db
    .prepare('SELECT * FROM orgs WHERE namespace_prefix = ?')
    .get(prefix) as OrgRow | undefined;
  return row ? rowToOrg(row) : null;
}

export function listOrgs(): Org[] {
  const db = getIdentityDb();
  const rows = db
    .prepare('SELECT * FROM orgs ORDER BY created_at_ms DESC')
    .all() as OrgRow[];
  return rows.map(rowToOrg);
}

export function setOrgTier(orgId: string, tier: OrgTier): Org {
  const db = getIdentityDb();
  const existing = getOrg(orgId);
  if (!existing) throw new Error(`Org ${orgId} not found.`);
  db.prepare('UPDATE orgs SET tier = ? WHERE id = ?').run(tier, orgId);
  return { ...existing, tier };
}

export type AssignOrgAdminInput = {
  orgId: string;
  handle: string;
  assignedBy: string;
};

/**
 * Assign org-admin. Idempotent on (org_id, handle) for ACTIVE rows —
 * if an unrevoked admin row already exists, returns it unchanged.
 * After a previous revoke, a new active row is created (the partial
 * UNIQUE index permits this).
 */
export function assignOrgAdmin(input: AssignOrgAdminInput): OrgAdmin {
  const db = getIdentityDb();
  const existing = db
    .prepare(
      `SELECT * FROM org_admins
        WHERE org_id = ? AND handle = ? AND revoked_at_ms IS NULL
        LIMIT 1`
    )
    .get(input.orgId, input.handle) as OrgAdminRow | undefined;
  if (existing) return rowToAdmin(existing);
  // Defensive existence check — FK ON DELETE CASCADE doesn't fire for
  // INSERT-on-missing-parent; we want a readable error rather than a
  // generic SQLITE_CONSTRAINT.
  const orgExists = db.prepare('SELECT 1 FROM orgs WHERE id = ? LIMIT 1').get(input.orgId);
  if (!orgExists) throw new Error(`Org ${input.orgId} not found.`);
  const admin: OrgAdmin = {
    id: randomUUID(),
    orgId: input.orgId,
    handle: input.handle,
    assignedBy: input.assignedBy,
    assignedAtMs: Date.now(),
    revokedAtMs: null,
    revokedBy: null
  };
  db.prepare(
    `INSERT INTO org_admins
      (id, org_id, handle, assigned_by, assigned_at_ms, revoked_at_ms, revoked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    admin.id,
    admin.orgId,
    admin.handle,
    admin.assignedBy,
    admin.assignedAtMs,
    null,
    null
  );
  return admin;
}

export type RevokeOrgAdminInput = {
  orgId: string;
  handle: string;
  revokedBy: string;
};

/**
 * Soft-revoke an org-admin. Returns true if an active row was revoked,
 * false if no active row existed for (org_id, handle).
 */
export function revokeOrgAdmin(input: RevokeOrgAdminInput): boolean {
  const db = getIdentityDb();
  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE org_admins
         SET revoked_at_ms = ?, revoked_by = ?
       WHERE org_id = ? AND handle = ? AND revoked_at_ms IS NULL`
    )
    .run(now, input.revokedBy, input.orgId, input.handle);
  return result.changes > 0;
}

export function listOrgAdmins(orgId: string): OrgAdmin[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT * FROM org_admins
        WHERE org_id = ? AND revoked_at_ms IS NULL
        ORDER BY assigned_at_ms ASC`
    )
    .all(orgId) as OrgAdminRow[];
  return rows.map(rowToAdmin);
}

export function isOrgAdmin(orgId: string, handle: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT 1 FROM org_admins
        WHERE org_id = ? AND handle = ? AND revoked_at_ms IS NULL
        LIMIT 1`
    )
    .get(orgId, handle);
  return Boolean(row);
}

export function resetOrgsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM org_admins').run();
  db.prepare('DELETE FROM orgs').run();
}
