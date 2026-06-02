/**
 * orgStore — the CLEAN identity model, point 1 of the JWPK spec:
 *   ORG -> USERS -> PRIVILEGES.
 *
 * An org (the instance org = "NewModel"). Users belong to the org. Each user
 * has a privilege (role). JWPK is a SuperAdmin. Humans and agents use the SAME
 * model — a user is just a handle with a role; nothing special-cases the
 * operator.
 *
 * This is a NEW, standalone store built to be cut over to. It does NOT touch
 * the legacy identity tables. Self-contained table init (answerCapsuleStore /
 * roomPolicyStore pattern) — no db.ts edit, plain CREATE TABLE IF NOT EXISTS
 * since these are brand-new tables (no pre-existing-schema ALTER needed).
 *
 * TABLE NAMING NOTE for the cutover owner: the spec dictates a table named
 * `orgs(org_id, name, created_at_ms)`, but a legacy multi-tenant `orgs` table
 * already exists in db.ts (id/display_name/namespace_prefix/tier...) with an
 * incompatible schema, and the build boundary forbids modifying it. So the
 * clean model owns its OWN table `ant_orgs` (same `ant_*` clean-model prefix as
 * `ant_sessions`) with the spec's exact columns. At cutover, the legacy `orgs`
 * F1 table is the DELETE-sweep owner's call. No concept was added — this is
 * pure name-collision avoidance.
 */

import { getIdentityDb } from './db';

/** A user's privilege within an org. Three levels, nothing more (spec). */
export type OrgRole = 'superadmin' | 'admin' | 'member';

const VALID_ROLES: ReadonlySet<string> = new Set<OrgRole>(['superadmin', 'admin', 'member']);

/** The canonical instance org per the spec. */
export const DEFAULT_ORG_ID = 'NewModel';
export const DEFAULT_ORG_NAME = 'NewModel';
/** The instance SuperAdmin per the spec. */
export const DEFAULT_SUPERADMIN_HANDLE = '@JWPK';

export type Org = {
  org_id: string;
  name: string;
  created_at_ms: number;
};

export type OrgUser = {
  org_id: string;
  handle: string;
  role: OrgRole;
  created_at_ms: number;
};

type OrgRow = { org_id: string; name: string; created_at_ms: number };
type OrgUserRow = { org_id: string; handle: string; role: string; created_at_ms: number };

function ensureTables(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ant_orgs (
      org_id        TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS org_users (
      org_id        TEXT NOT NULL,
      handle        TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('superadmin','admin','member')),
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (org_id, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_org_users_handle ON org_users (handle);
  `);
}

/** Create the org if absent (idempotent). Existing org keeps its name. */
export function ensureOrg(orgId: string, name: string, db = getIdentityDb()): Org {
  ensureTables(db);
  const existing = db.prepare(`SELECT * FROM ant_orgs WHERE org_id = ?`).get(orgId) as OrgRow | undefined;
  if (existing) {
    return { org_id: existing.org_id, name: existing.name, created_at_ms: existing.created_at_ms };
  }
  const now = Date.now();
  db.prepare(`INSERT INTO ant_orgs (org_id, name, created_at_ms) VALUES (?, ?, ?)`).run(orgId, name, now);
  return { org_id: orgId, name, created_at_ms: now };
}

/**
 * Add (or update the role of) a user in an org. Keyed by (org_id, handle):
 * re-adding the same handle updates the role rather than erroring. The user's
 * created_at_ms is preserved on update.
 */
export function addUser(orgId: string, handle: string, role: OrgRole, db = getIdentityDb()): OrgUser {
  ensureTables(db);
  if (!VALID_ROLES.has(role)) {
    throw new Error(`addUser: unknown role '${role}'`);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO org_users (org_id, handle, role, created_at_ms)
     VALUES (@org_id, @handle, @role, @created_at_ms)
     ON CONFLICT (org_id, handle) DO UPDATE SET role = excluded.role`
  ).run({ org_id: orgId, handle, role, created_at_ms: now });
  const row = db
    .prepare(`SELECT * FROM org_users WHERE org_id = ? AND handle = ?`)
    .get(orgId, handle) as OrgUserRow;
  return { org_id: row.org_id, handle: row.handle, role: row.role as OrgRole, created_at_ms: row.created_at_ms };
}

/**
 * The role of a handle. When orgId is given, scoped to that org. When omitted,
 * returns the handle's role in ANY org (the highest-privilege wins so a
 * superadmin in one org reads as superadmin), or null if the handle is in no
 * org.
 */
export function getUserRole(handle: string, orgId?: string, db = getIdentityDb()): OrgRole | null {
  ensureTables(db);
  if (orgId !== undefined) {
    const row = db
      .prepare(`SELECT role FROM org_users WHERE org_id = ? AND handle = ?`)
      .get(orgId, handle) as { role: string } | undefined;
    return row ? (row.role as OrgRole) : null;
  }
  const rows = db
    .prepare(`SELECT role FROM org_users WHERE handle = ?`)
    .all(handle) as Array<{ role: string }>;
  if (rows.length === 0) return null;
  const rank: Record<OrgRole, number> = { member: 0, admin: 1, superadmin: 2 };
  let best: OrgRole = 'member';
  for (const r of rows) {
    const role = r.role as OrgRole;
    if (rank[role] > rank[best]) best = role;
  }
  return best;
}

/** True if the handle has role 'superadmin' in any (or the given) org. */
export function isSuperAdmin(handle: string, orgId?: string, db = getIdentityDb()): boolean {
  return getUserRole(handle, orgId, db) === 'superadmin';
}

/** List the users of an org, oldest first. */
export function listUsers(orgId: string, db = getIdentityDb()): OrgUser[] {
  ensureTables(db);
  const rows = db
    .prepare(`SELECT * FROM org_users WHERE org_id = ? ORDER BY created_at_ms ASC, handle ASC`)
    .all(orgId) as OrgUserRow[];
  return rows.map((r) => ({
    org_id: r.org_id,
    handle: r.handle,
    role: r.role as OrgRole,
    created_at_ms: r.created_at_ms
  }));
}

/**
 * Seed the canonical instance org ('NewModel') and make '@JWPK' a superadmin.
 * Idempotent — safe to call repeatedly; never downgrades an existing JWPK role.
 * NOT auto-run: the cutover owner calls this once.
 */
export function seedDefaultOrg(db = getIdentityDb()): { org: Org; superAdmin: OrgUser } {
  const org = ensureOrg(DEFAULT_ORG_ID, DEFAULT_ORG_NAME, db);
  const existing = getUserRole(DEFAULT_SUPERADMIN_HANDLE, DEFAULT_ORG_ID, db);
  const superAdmin =
    existing === 'superadmin'
      ? (listUsers(DEFAULT_ORG_ID, db).find((u) => u.handle === DEFAULT_SUPERADMIN_HANDLE) as OrgUser)
      : addUser(DEFAULT_ORG_ID, DEFAULT_SUPERADMIN_HANDLE, 'superadmin', db);
  return { org, superAdmin };
}
