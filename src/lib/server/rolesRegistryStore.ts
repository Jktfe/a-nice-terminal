/**
 * rolesRegistryStore — M6.1 RBAC role registry of the antOS Enterprise
 * Control Plane plan.
 *
 * Replaces ad-hoc endpoint gates (room_owner / org_admin / plan_owner /
 * isAdminBearer) with an enumerable, exportable, procurement-ready role
 * model. Each role carries a set of (capability, scope) pairs and is
 * assignable to an identity handle scoped to global / org / room / session.
 *
 * Role IDs are string-stable. The parallel `enterpriseCapabilityPolicy`
 * work (commit 3cbfc32, raw-PTY gate via tool_grants_v02) targets these
 * IDs by string so M3 / M4 capability gating can dependency-seam onto
 * them without coupling to row layout.
 *
 * Seeding:
 *   The four canonical roles below are inserted by `seedRolesRegistry`
 *   with is_seeded=1 so admin-bearer writers cannot accidentally delete
 *   or relabel them. The check is idempotent — re-running on a populated
 *   DB is a no-op.
 *
 * Capability semantics:
 *   `capability` is a dot-namespaced string (`room.read`, `room.write`,
 *   `verification.author`, ...) or `*` for the wildcard. The store does
 *   NOT interpret these strings; gates / policies read them at the call
 *   site. Stable role IDs + opaque capability strings keep this slice
 *   decoupled from the policy layer.
 *
 * Coordination:
 *   - audit_events writes on assignment land via a no-op stub today
 *     (the M7.1 audit store is being built in parallel). Once a wrapper
 *     module ships, swap the stub in `recordAuditEvent` for the real
 *     call. The CHECK constraint on entity_kind does not yet cover
 *     'role' / 'role_assignment'; we use 'system' so the write does not
 *     reject when audit_events is present.
 */

import { randomBytes } from 'node:crypto';
import { getIdentityDb } from './db';

export type RoleCapability = {
  capability: string;
  scope: string;
};

export type RoleRecord = {
  roleId: string;
  name: string;
  description: string | null;
  createdAtMs: number;
  isSeeded: boolean;
  capabilities: RoleCapability[];
};

export type RoleAssignmentRecord = {
  assignmentId: string;
  roleId: string;
  identityHandle: string;
  scopeKind: string;
  scopeId: string | null;
  assignedAtMs: number;
  assignedByHandle: string;
};

export const ROLE_ID_CONFLICT = 'ROLE_ID_CONFLICT';
export const SEEDED_ROLE_PROTECTED = 'SEEDED_ROLE_PROTECTED';

export const SEEDED_ROLE_IDS = [
  'super-admin',
  'org-admin',
  'room-owner',
  'member'
] as const;

const SEEDED_ROLE_SPECS: ReadonlyArray<{
  roleId: string;
  name: string;
  description: string;
  capabilities: RoleCapability[];
}> = [
  {
    roleId: 'super-admin',
    name: 'Super Admin',
    description: 'Wildcard authority at global scope. Break-glass tier.',
    capabilities: [{ capability: '*', scope: 'global' }]
  },
  {
    roleId: 'org-admin',
    name: 'Org Admin',
    description: 'Manages an organisation: rooms, members, sub-admins.',
    capabilities: [
      { capability: 'org.*', scope: 'org' },
      { capability: 'room.write', scope: 'org' },
      { capability: 'member.invite', scope: 'org' },
      { capability: 'member.remove', scope: 'org' }
    ]
  },
  {
    roleId: 'room-owner',
    name: 'Room Owner',
    description: 'Owns a room: write access + roster + verification authoring.',
    capabilities: [
      { capability: 'room.write', scope: 'room' },
      { capability: 'member.invite', scope: 'room' },
      { capability: 'member.remove', scope: 'room' },
      { capability: 'verification.author', scope: 'room' }
    ]
  },
  {
    roleId: 'member',
    name: 'Member',
    description: 'Default participant in a room — read access only.',
    capabilities: [
      { capability: 'room.read', scope: 'room' },
      { capability: 'verification.read', scope: 'room' }
    ]
  }
];

function normaliseHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function generateAssignmentId(): string {
  return `ra_${randomBytes(8).toString('hex')}`;
}

type RoleRow = {
  role_id: string;
  name: string;
  description: string | null;
  created_at_ms: number;
  is_seeded: number;
};

type CapRow = {
  role_id: string;
  capability: string;
  scope: string;
};

type AssignmentRow = {
  assignment_id: string;
  role_id: string;
  identity_handle: string;
  scope_kind: string;
  scope_id: string | null;
  assigned_at_ms: number;
  assigned_by_handle: string;
};

function rowToRecord(row: RoleRow, caps: CapRow[]): RoleRecord {
  return {
    roleId: row.role_id,
    name: row.name,
    description: row.description,
    createdAtMs: row.created_at_ms,
    isSeeded: row.is_seeded === 1,
    capabilities: caps
      .filter((c) => c.role_id === row.role_id)
      .map((c) => ({ capability: c.capability, scope: c.scope }))
  };
}

function assignmentRowToRecord(row: AssignmentRow): RoleAssignmentRecord {
  return {
    assignmentId: row.assignment_id,
    roleId: row.role_id,
    identityHandle: row.identity_handle,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    assignedAtMs: row.assigned_at_ms,
    assignedByHandle: row.assigned_by_handle
  };
}

/**
 * Insert the four canonical seeded roles when missing. Idempotent: a
 * row with is_seeded=1 is treated as authoritative and skipped on
 * subsequent runs even if its name/description has been edited via
 * direct SQL (the API gate refuses such edits, but the seed itself
 * does not overwrite — operator intent wins).
 */
export function seedRolesRegistry(nowMs?: number): void {
  const db = getIdentityDb();
  const at = nowMs ?? Date.now();
  const insertRole = db.prepare(
    `INSERT OR IGNORE INTO roles (role_id, name, description, created_at_ms, is_seeded)
     VALUES (?, ?, ?, ?, 1)`
  );
  const insertCap = db.prepare(
    `INSERT OR IGNORE INTO role_capabilities (role_id, capability, scope)
     VALUES (?, ?, ?)`
  );
  const seed = db.transaction(() => {
    for (const spec of SEEDED_ROLE_SPECS) {
      const existing = db
        .prepare(`SELECT is_seeded FROM roles WHERE role_id = ?`)
        .get(spec.roleId) as { is_seeded: number } | undefined;
      if (existing && existing.is_seeded === 1) continue;
      insertRole.run(spec.roleId, spec.name, spec.description, at);
      for (const cap of spec.capabilities) {
        insertCap.run(spec.roleId, cap.capability, cap.scope);
      }
    }
  });
  seed();
}

export function listRoles(): RoleRecord[] {
  const db = getIdentityDb();
  const roleRows = db
    .prepare(`SELECT * FROM roles ORDER BY role_id ASC`)
    .all() as RoleRow[];
  if (roleRows.length === 0) return [];
  const capRows = db
    .prepare(`SELECT role_id, capability, scope FROM role_capabilities`)
    .all() as CapRow[];
  return roleRows.map((r) => rowToRecord(r, capRows));
}

export function getRole(roleId: string): RoleRecord | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM roles WHERE role_id = ?`)
    .get(roleId) as RoleRow | undefined;
  if (!row) return null;
  const caps = db
    .prepare(
      `SELECT role_id, capability, scope FROM role_capabilities WHERE role_id = ?`
    )
    .all(roleId) as CapRow[];
  return rowToRecord(row, caps);
}

export type CreateRoleInput = {
  roleId: string;
  name: string;
  description?: string | null;
  capabilities: RoleCapability[];
  nowMs?: number;
};

export function createRole(input: CreateRoleInput): RoleRecord {
  const db = getIdentityDb();
  const at = input.nowMs ?? Date.now();
  const exists = db
    .prepare(`SELECT role_id FROM roles WHERE role_id = ?`)
    .get(input.roleId);
  if (exists) throw new Error(ROLE_ID_CONFLICT);
  const insertCap = db.prepare(
    `INSERT INTO role_capabilities (role_id, capability, scope) VALUES (?, ?, ?)`
  );
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO roles (role_id, name, description, created_at_ms, is_seeded)
       VALUES (?, ?, ?, ?, 0)`
    ).run(input.roleId, input.name, input.description ?? null, at);
    for (const cap of input.capabilities) {
      insertCap.run(input.roleId, cap.capability, cap.scope);
    }
  });
  try {
    insert();
  } catch (cause) {
    // UNIQUE on name fires here when a second role re-uses the name —
    // surface a clean conflict error to API callers.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('UNIQUE')) throw new Error(ROLE_ID_CONFLICT);
    throw cause;
  }
  const created = getRole(input.roleId);
  if (!created) {
    throw new Error('createRole: failed to read back inserted row');
  }
  return created;
}

export type UpdateRolePatch = {
  name?: string;
  description?: string | null;
  capabilities?: RoleCapability[];
};

export function updateRole(roleId: string, patch: UpdateRolePatch): RoleRecord {
  const db = getIdentityDb();
  const existing = db
    .prepare(`SELECT * FROM roles WHERE role_id = ?`)
    .get(roleId) as RoleRow | undefined;
  if (!existing) throw new Error('ROLE_NOT_FOUND');
  if (existing.is_seeded === 1) throw new Error(SEEDED_ROLE_PROTECTED);
  const update = db.transaction(() => {
    if (patch.name !== undefined) {
      db.prepare(`UPDATE roles SET name = ? WHERE role_id = ?`).run(
        patch.name,
        roleId
      );
    }
    if (patch.description !== undefined) {
      db.prepare(`UPDATE roles SET description = ? WHERE role_id = ?`).run(
        patch.description,
        roleId
      );
    }
    if (patch.capabilities !== undefined) {
      db.prepare(`DELETE FROM role_capabilities WHERE role_id = ?`).run(roleId);
      const insertCap = db.prepare(
        `INSERT INTO role_capabilities (role_id, capability, scope) VALUES (?, ?, ?)`
      );
      for (const cap of patch.capabilities) {
        insertCap.run(roleId, cap.capability, cap.scope);
      }
    }
  });
  update();
  const updated = getRole(roleId);
  if (!updated) {
    throw new Error('updateRole: failed to read back updated row');
  }
  return updated;
}

export function deleteRole(roleId: string): void {
  const db = getIdentityDb();
  const existing = db
    .prepare(`SELECT is_seeded FROM roles WHERE role_id = ?`)
    .get(roleId) as { is_seeded: number } | undefined;
  if (!existing) return;
  if (existing.is_seeded === 1) throw new Error(SEEDED_ROLE_PROTECTED);
  // ON DELETE CASCADE on role_capabilities + role_assignments removes
  // children atomically; this guards the test that asserts assignments
  // are cleaned up first.
  db.prepare(`DELETE FROM roles WHERE role_id = ?`).run(roleId);
}

export type AssignRoleInput = {
  roleId: string;
  identityHandle: string;
  scopeKind: string;
  scopeId: string | null;
  assignedByHandle: string;
  nowMs?: number;
};

/**
 * Best-effort audit hook. The M7.1 audit store is being built in parallel;
 * once it lands, swap the body for a real `recordAuditEvent({ kind: ... })`
 * call. Today we attempt a raw insert against `audit_events` when present
 * so the audit trail is not silently dropped, but we swallow failures
 * because (a) the audit_events.entity_kind CHECK does not yet include
 * 'role_assignment' (we map to 'system'), and (b) parallel branches may
 * tighten the schema mid-flight.
 *
 * TODO(M7.1): replace with `auditEventsStore.recordEvent({...})` once
 * the canonical helper module lands.
 */
function recordAuditEvent(payload: {
  kind: string;
  entityId: string;
  actorHandle: string;
  afterJson: Record<string, unknown>;
  nowMs: number;
}): void {
  try {
    const db = getIdentityDb();
    const hasTable = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'`
      )
      .get();
    if (!hasTable) return;
    const auditId = `aud_${randomBytes(8).toString('hex')}`;
    db.prepare(
      `INSERT INTO audit_events (audit_id, at_ms, kind, entity_kind, entity_id,
         actor_agent_id, actor_runtime_id, before_json, after_json,
         request_id, ip_hash, challenge_proof)
       VALUES (?, ?, ?, 'system', ?, NULL, NULL, NULL, ?, NULL, NULL, NULL)`
    ).run(
      auditId,
      payload.nowMs,
      payload.kind,
      payload.entityId,
      JSON.stringify({ ...payload.afterJson, actor_handle: payload.actorHandle })
    );
  } catch {
    // M7.1 will own the canonical path — until then keep this a no-op
    // on schema drift.
  }
}

export function assignRole(input: AssignRoleInput): RoleAssignmentRecord {
  const db = getIdentityDb();
  const role = getRole(input.roleId);
  if (!role) throw new Error('ROLE_NOT_FOUND');
  const at = input.nowMs ?? Date.now();
  const assignmentId = generateAssignmentId();
  const identityHandle = normaliseHandle(input.identityHandle);
  const assignedByHandle = normaliseHandle(input.assignedByHandle);
  db.prepare(
    `INSERT INTO role_assignments (assignment_id, role_id, identity_handle,
       scope_kind, scope_id, assigned_at_ms, assigned_by_handle)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assignmentId,
    input.roleId,
    identityHandle,
    input.scopeKind,
    input.scopeId,
    at,
    assignedByHandle
  );
  recordAuditEvent({
    kind: 'role.assigned',
    entityId: assignmentId,
    actorHandle: assignedByHandle,
    afterJson: {
      role_id: input.roleId,
      identity_handle: identityHandle,
      scope_kind: input.scopeKind,
      scope_id: input.scopeId
    },
    nowMs: at
  });
  return {
    assignmentId,
    roleId: input.roleId,
    identityHandle,
    scopeKind: input.scopeKind,
    scopeId: input.scopeId,
    assignedAtMs: at,
    assignedByHandle
  };
}

export function unassignRole(assignmentId: string, nowMs?: number): void {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM role_assignments WHERE assignment_id = ?`)
    .get(assignmentId) as AssignmentRow | undefined;
  if (!row) return;
  db.prepare(`DELETE FROM role_assignments WHERE assignment_id = ?`).run(
    assignmentId
  );
  recordAuditEvent({
    kind: 'role.unassigned',
    entityId: assignmentId,
    actorHandle: row.assigned_by_handle,
    afterJson: {
      role_id: row.role_id,
      identity_handle: row.identity_handle,
      scope_kind: row.scope_kind,
      scope_id: row.scope_id
    },
    nowMs: nowMs ?? Date.now()
  });
}

export function listAssignmentsFor(identityHandle: string): RoleAssignmentRecord[] {
  const db = getIdentityDb();
  const handle = normaliseHandle(identityHandle);
  const rows = db
    .prepare(
      `SELECT * FROM role_assignments
       WHERE identity_handle = ?
       ORDER BY assigned_at_ms ASC`
    )
    .all(handle) as AssignmentRow[];
  return rows.map(assignmentRowToRecord);
}

export function listAssignmentsByRole(roleId: string): RoleAssignmentRecord[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT * FROM role_assignments
       WHERE role_id = ?
       ORDER BY assigned_at_ms ASC`
    )
    .all(roleId) as AssignmentRow[];
  return rows.map(assignmentRowToRecord);
}

/**
 * Test-only reset hook. Mirrors the pattern in grantsShimStore /
 * toolsCatalogStore: clears every roles* row so each test starts with a
 * deterministic empty registry. Production code never calls this.
 */
export function resetRolesRegistryForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM role_assignments`).run();
  db.prepare(`DELETE FROM role_capabilities`).run();
  db.prepare(`DELETE FROM roles`).run();
}
