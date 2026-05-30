/**
 * toolsCatalogStore — PR-D tools catalog migration (plan milestones
 * pr-d-tools-catalog + pr-d2-import-skills of ant-substrate-v0.2-2026-05-29).
 *
 * Motivation (JWPK msg_mjh7rgi3wa + msg_6gq9zczigb, 2026-05-30 ~01:00 BST):
 *   He deleted the ntfy/nifty skill from his Obsidian vault but it kept
 *   being referenced by agents because there's NO CANONICAL CATALOG.
 *   Skills load from filesystem globs, MCPs from per-client config,
 *   CLI verbs from hardcoded dispatch tables. "What skills does this
 *   agent have access to?" had no single answer. This store + the
 *   `ant audit tools/grants/orphans/revocations` verbs close that gap
 *   by making the catalog a queryable surface, not an assumed one.
 *
 * Coexistence:
 *   `tool_grants_v02` is named to coexist with `caller_grants`
 *   (2026-05-19 slice) and `grants_shim` (PR #98 Stage A). The v0.2
 *   cut-over will consolidate these — that's a planned milestone, not
 *   this PR. The store is pure CRUD + lookup; no ed25519, no signing.
 *
 * Lifecycle:
 *   - active     : added_at_ms set, no deprecated_at_ms, no retired_at_ms
 *   - deprecated : deprecated_at_ms set, still usable, flagged for removal
 *   - retired    : retired_at_ms set, NOT usable; grants pointing here
 *                  become "orphan grants" (the nifty-leak detector hook)
 *
 * The UNIQUE INDEX on (tool_slug) WHERE retired_at_ms IS NULL means you
 * can retire+re-register the same slug to recover from a botched import.
 */

import { randomBytes } from 'node:crypto';
import { getIdentityDb } from './db';

export type ToolKind = 'skill' | 'mcp' | 'cli-verb' | 'hook' | 'plugin' | 'bridge';
export type ToolMinTier = 'oss' | 'premium' | 'internal';
export type ToolGrantScopeKind = 'global' | 'org' | 'room' | 'session';

export type ToolRecord = {
  toolId: string;
  toolSlug: string;
  kind: ToolKind;
  name: string;
  description: string | null;
  version: string | null;
  sourcePath: string | null;
  ownerOrg: string | null;
  minTier: ToolMinTier;
  addedAtMs: number;
  deprecatedAtMs: number | null;
  retiredAtMs: number | null;
  metadata: Record<string, unknown> | null;
};

export type ToolGrantRecord = {
  grantId: string;
  granteeHandle: string;
  toolId: string;
  scopeKind: ToolGrantScopeKind;
  scopeId: string | null;
  grantedByHandle: string;
  grantedAtMs: number;
  revokedAtMs: number | null;
  expiresAtMs: number | null;
  reason: string | null;
};

type ToolRow = {
  tool_id: string;
  tool_slug: string;
  kind: string;
  name: string;
  description: string | null;
  version: string | null;
  source_path: string | null;
  owner_org: string | null;
  min_tier: string | null;
  added_at_ms: number;
  deprecated_at_ms: number | null;
  retired_at_ms: number | null;
  metadata_json: string | null;
};

type GrantRow = {
  grant_id: string;
  grantee_handle: string;
  tool_id: string;
  scope_kind: string;
  scope_id: string | null;
  granted_by_handle: string;
  granted_at_ms: number;
  revoked_at_ms: number | null;
  expires_at_ms: number | null;
  reason: string | null;
};

const VALID_KINDS: ReadonlyArray<ToolKind> = [
  'skill',
  'mcp',
  'cli-verb',
  'hook',
  'plugin',
  'bridge'
];

const VALID_MIN_TIERS: ReadonlyArray<ToolMinTier> = ['oss', 'premium', 'internal'];

const VALID_SCOPE_KINDS: ReadonlyArray<ToolGrantScopeKind> = [
  'global',
  'org',
  'room',
  'session'
];

function rowToTool(row: ToolRow): ToolRecord {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata_json) {
    try {
      const parsed = JSON.parse(row.metadata_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = null;
    }
  }
  return {
    toolId: row.tool_id,
    toolSlug: row.tool_slug,
    kind: row.kind as ToolKind,
    name: row.name,
    description: row.description,
    version: row.version,
    sourcePath: row.source_path,
    ownerOrg: row.owner_org,
    minTier: (row.min_tier ?? 'oss') as ToolMinTier,
    addedAtMs: row.added_at_ms,
    deprecatedAtMs: row.deprecated_at_ms,
    retiredAtMs: row.retired_at_ms,
    metadata
  };
}

function rowToGrant(row: GrantRow): ToolGrantRecord {
  return {
    grantId: row.grant_id,
    granteeHandle: row.grantee_handle,
    toolId: row.tool_id,
    scopeKind: row.scope_kind as ToolGrantScopeKind,
    scopeId: row.scope_id,
    grantedByHandle: row.granted_by_handle,
    grantedAtMs: row.granted_at_ms,
    revokedAtMs: row.revoked_at_ms,
    expiresAtMs: row.expires_at_ms,
    reason: row.reason
  };
}

function generateToolId(): string {
  return `tool_${randomBytes(8).toString('hex')}`;
}

function generateGrantId(): string {
  return `tg_${randomBytes(8).toString('hex')}`;
}

function normaliseHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

export type RegisterToolInput = {
  toolSlug: string;
  kind: ToolKind;
  name: string;
  description?: string;
  version?: string;
  sourcePath?: string;
  ownerOrg?: string;
  minTier?: ToolMinTier;
  metadata?: Record<string, unknown>;
  /** Override the wall-clock for tests. */
  nowMs?: number;
};

/**
 * Register a tool. INSERT-or-no-op semantics: when an active row with
 * the same tool_slug already exists, returns the existing row unchanged.
 * Retired rows do NOT block registration (re-register after retire is
 * how you recover from a botched import).
 */
export function registerTool(input: RegisterToolInput): ToolRecord {
  if (!input.toolSlug?.trim()) {
    throw new Error('registerTool: toolSlug required');
  }
  if (!VALID_KINDS.includes(input.kind)) {
    throw new Error(`registerTool: invalid kind "${input.kind}"`);
  }
  if (!input.name?.trim()) {
    throw new Error('registerTool: name required');
  }
  if (input.minTier && !VALID_MIN_TIERS.includes(input.minTier)) {
    throw new Error(`registerTool: invalid minTier "${input.minTier}"`);
  }

  const db = getIdentityDb();
  const existing = findToolBySlug(input.toolSlug);
  if (existing) return existing;

  const toolId = generateToolId();
  const addedAtMs = input.nowMs ?? Date.now();
  const minTier = input.minTier ?? 'oss';
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  db.prepare(
    `INSERT INTO tools_catalog
       (tool_id, tool_slug, kind, name, description, version,
        source_path, owner_org, min_tier, added_at_ms,
        deprecated_at_ms, retired_at_ms, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).run(
    toolId,
    input.toolSlug,
    input.kind,
    input.name,
    input.description ?? null,
    input.version ?? null,
    input.sourcePath ?? null,
    input.ownerOrg ?? null,
    minTier,
    addedAtMs,
    metadataJson
  );

  return {
    toolId,
    toolSlug: input.toolSlug,
    kind: input.kind,
    name: input.name,
    description: input.description ?? null,
    version: input.version ?? null,
    sourcePath: input.sourcePath ?? null,
    ownerOrg: input.ownerOrg ?? null,
    minTier,
    addedAtMs,
    deprecatedAtMs: null,
    retiredAtMs: null,
    metadata: input.metadata ?? null
  };
}

/**
 * Soft-deprecate a tool. Still usable but flagged for removal. Idempotent
 * — re-deprecating a deprecated tool is a no-op.
 */
export function deprecateTool(toolId: string, deprecatedAtMs?: number): ToolRecord | null {
  const db = getIdentityDb();
  const now = deprecatedAtMs ?? Date.now();
  db.prepare(
    `UPDATE tools_catalog
       SET deprecated_at_ms = COALESCE(deprecated_at_ms, ?)
     WHERE tool_id = ?
       AND retired_at_ms IS NULL`
  ).run(now, toolId);
  return findToolById(toolId);
}

/**
 * Fully retire a tool. Grants pointing at it become "orphan grants" —
 * surfaced by listOrphanGrants(). The unique-slug index excludes retired
 * rows so the same slug can be re-registered after retire.
 */
export function retireTool(toolId: string, retiredAtMs?: number): ToolRecord | null {
  const db = getIdentityDb();
  const now = retiredAtMs ?? Date.now();
  db.prepare(
    `UPDATE tools_catalog
       SET retired_at_ms = COALESCE(retired_at_ms, ?)
     WHERE tool_id = ?`
  ).run(now, toolId);
  return findToolById(toolId);
}

export type ListToolsFilters = {
  kind?: ToolKind;
  ownerOrg?: string;
  includeRetired?: boolean;
};

export function listTools(filters: ListToolsFilters = {}): ToolRecord[] {
  const db = getIdentityDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (!filters.includeRetired) {
    conditions.push('retired_at_ms IS NULL');
  }
  if (filters.kind) {
    conditions.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.ownerOrg) {
    conditions.push('owner_org = ?');
    params.push(filters.ownerOrg);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tools_catalog ${where} ORDER BY added_at_ms DESC`)
    .all(...params) as ToolRow[];
  return rows.map(rowToTool);
}

export function findToolBySlug(slug: string, options: { includeRetired?: boolean } = {}): ToolRecord | null {
  const db = getIdentityDb();
  const sql = options.includeRetired
    ? `SELECT * FROM tools_catalog WHERE tool_slug = ? ORDER BY added_at_ms DESC LIMIT 1`
    : `SELECT * FROM tools_catalog WHERE tool_slug = ? AND retired_at_ms IS NULL ORDER BY added_at_ms DESC LIMIT 1`;
  const row = db.prepare(sql).get(slug) as ToolRow | undefined;
  return row ? rowToTool(row) : null;
}

export function findToolById(toolId: string): ToolRecord | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM tools_catalog WHERE tool_id = ?`).get(toolId) as
    | ToolRow
    | undefined;
  return row ? rowToTool(row) : null;
}

export type GrantToolInput = {
  granteeHandle: string;
  toolId: string;
  scopeKind: ToolGrantScopeKind;
  scopeId?: string;
  grantedByHandle: string;
  expiresAtMs?: number;
  reason?: string;
  nowMs?: number;
};

/**
 * Grant a tool capability to an agent. Append-only — re-granting on top
 * of an existing active grant creates a second active row (matching
 * grants_shim's append semantics). Use lookupActiveGrant to find the
 * most recent.
 */
export function grantTool(input: GrantToolInput): ToolGrantRecord {
  if (!VALID_SCOPE_KINDS.includes(input.scopeKind)) {
    throw new Error(`grantTool: invalid scopeKind "${input.scopeKind}"`);
  }
  // Verify the tool exists. We deliberately allow grants against
  // deprecated tools (still usable) but NOT retired ones — granting a
  // retired tool is the bug the catalog exists to prevent.
  const tool = findToolById(input.toolId);
  if (!tool) {
    throw new Error(`grantTool: tool ${input.toolId} not found`);
  }
  if (tool.retiredAtMs !== null) {
    throw new Error(`grantTool: tool ${input.toolId} is retired`);
  }
  const db = getIdentityDb();
  const grantId = generateGrantId();
  const grantedAtMs = input.nowMs ?? Date.now();
  const granteeHandle = normaliseHandle(input.granteeHandle);
  const grantedByHandle = normaliseHandle(input.grantedByHandle);

  db.prepare(
    `INSERT INTO tool_grants_v02
       (grant_id, grantee_handle, tool_id, scope_kind, scope_id,
        granted_by_handle, granted_at_ms, revoked_at_ms, expires_at_ms, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    grantId,
    granteeHandle,
    input.toolId,
    input.scopeKind,
    input.scopeId ?? null,
    grantedByHandle,
    grantedAtMs,
    input.expiresAtMs ?? null,
    input.reason ?? null
  );

  return {
    grantId,
    granteeHandle,
    toolId: input.toolId,
    scopeKind: input.scopeKind,
    scopeId: input.scopeId ?? null,
    grantedByHandle,
    grantedAtMs,
    revokedAtMs: null,
    expiresAtMs: input.expiresAtMs ?? null,
    reason: input.reason ?? null
  };
}

export type RevokeToolGrantInput = {
  granteeHandle: string;
  toolId: string;
  scopeKind: ToolGrantScopeKind;
  scopeId?: string;
  nowMs?: number;
};

/**
 * Soft-revoke every currently-active grant matching (grantee, tool,
 * scope). Returns the count of rows revoked. Idempotent.
 */
export function revokeToolGrant(input: RevokeToolGrantInput): number {
  const db = getIdentityDb();
  const now = input.nowMs ?? Date.now();
  const granteeHandle = normaliseHandle(input.granteeHandle);
  // scope_id IS NULL match must use IS NULL not = NULL (SQL trichotomy).
  if (input.scopeId === undefined || input.scopeId === null) {
    const result = db
      .prepare(
        `UPDATE tool_grants_v02
           SET revoked_at_ms = ?
         WHERE grantee_handle = ?
           AND tool_id = ?
           AND scope_kind = ?
           AND scope_id IS NULL
           AND revoked_at_ms IS NULL`
      )
      .run(now, granteeHandle, input.toolId, input.scopeKind);
    return result.changes;
  }
  const result = db
    .prepare(
      `UPDATE tool_grants_v02
         SET revoked_at_ms = ?
       WHERE grantee_handle = ?
         AND tool_id = ?
         AND scope_kind = ?
         AND scope_id = ?
         AND revoked_at_ms IS NULL`
    )
    .run(now, granteeHandle, input.toolId, input.scopeKind, input.scopeId);
  return result.changes;
}

export type LookupGrantInput = {
  granteeHandle: string;
  toolId: string;
  scopeKind: ToolGrantScopeKind;
  scopeId?: string;
};

/**
 * Return the most recent active grant for (grantee, tool, scope) or null.
 * Active = revoked_at_ms IS NULL AND (expires_at_ms IS NULL OR expires_at_ms > now).
 */
export function lookupActiveGrant(input: LookupGrantInput, nowMs?: number): ToolGrantRecord | null {
  const db = getIdentityDb();
  const now = nowMs ?? Date.now();
  const granteeHandle = normaliseHandle(input.granteeHandle);
  const baseClauses =
    `grantee_handle = ?
       AND tool_id = ?
       AND scope_kind = ?
       AND revoked_at_ms IS NULL
       AND (expires_at_ms IS NULL OR expires_at_ms > ?)`;
  if (input.scopeId === undefined || input.scopeId === null) {
    const row = db
      .prepare(
        `SELECT * FROM tool_grants_v02
          WHERE ${baseClauses}
            AND scope_id IS NULL
          ORDER BY granted_at_ms DESC LIMIT 1`
      )
      .get(granteeHandle, input.toolId, input.scopeKind, now) as GrantRow | undefined;
    return row ? rowToGrant(row) : null;
  }
  const row = db
    .prepare(
      `SELECT * FROM tool_grants_v02
        WHERE ${baseClauses}
          AND scope_id = ?
        ORDER BY granted_at_ms DESC LIMIT 1`
    )
    .get(granteeHandle, input.toolId, input.scopeKind, now, input.scopeId) as
    | GrantRow
    | undefined;
  return row ? rowToGrant(row) : null;
}

/** Every grant (active + revoked) for an agent — audit surface. */
export function listGrantsForAgent(granteeHandle: string): ToolGrantRecord[] {
  const db = getIdentityDb();
  const handle = normaliseHandle(granteeHandle);
  const rows = db
    .prepare(
      `SELECT * FROM tool_grants_v02
        WHERE grantee_handle = ?
        ORDER BY granted_at_ms DESC`
    )
    .all(handle) as GrantRow[];
  return rows.map(rowToGrant);
}

/** Every grant (active + revoked) for a tool — audit surface. */
export function listGrantsForTool(toolId: string): ToolGrantRecord[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT * FROM tool_grants_v02
        WHERE tool_id = ?
        ORDER BY granted_at_ms DESC`
    )
    .all(toolId) as GrantRow[];
  return rows.map(rowToGrant);
}

/**
 * Orphan grants: active grants pointing at retired tools. This is the
 * nifty-leak detector — the JWPK scenario was "deleted skill still
 * referenced by agents", which manifests here as a row whose tool is
 * retired but whose own revoked_at_ms is NULL.
 */
export function listOrphanGrants(): ToolGrantRecord[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT g.* FROM tool_grants_v02 g
       INNER JOIN tools_catalog t ON t.tool_id = g.tool_id
        WHERE g.revoked_at_ms IS NULL
          AND t.retired_at_ms IS NOT NULL
        ORDER BY g.granted_at_ms DESC`
    )
    .all() as GrantRow[];
  return rows.map(rowToGrant);
}

/**
 * Orphan tools: active tools with zero active grants. Cleanup candidates.
 * The "30-day no-activity" half of the spec lives in the CLI renderer
 * because activity tracking will join skill_invocations once that table
 * lands — keeping the store call minimal until then.
 */
export function listOrphanedTools(): ToolRecord[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT t.* FROM tools_catalog t
        WHERE t.retired_at_ms IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM tool_grants_v02 g
             WHERE g.tool_id = t.tool_id
               AND g.revoked_at_ms IS NULL
          )
        ORDER BY t.added_at_ms ASC`
    )
    .all() as ToolRow[];
  return rows.map(rowToTool);
}

/**
 * Revocations recorded since the given wall-clock ms. Used by
 * `ant audit revocations --since 7d`.
 */
export function listRevocationsSince(sinceMs: number): ToolGrantRecord[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT * FROM tool_grants_v02
        WHERE revoked_at_ms IS NOT NULL
          AND revoked_at_ms >= ?
        ORDER BY revoked_at_ms DESC`
    )
    .all(sinceMs) as GrantRow[];
  return rows.map(rowToGrant);
}

/**
 * Number of active grants for a tool — used by `ant audit tools`
 * grant-count column.
 */
export function countActiveGrantsForTool(toolId: string): number {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tool_grants_v02
        WHERE tool_id = ?
          AND revoked_at_ms IS NULL`
    )
    .get(toolId) as { c: number } | undefined;
  return row?.c ?? 0;
}

/** Test-only reset. */
export function resetToolsCatalogForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM tool_grants_v02`).run();
  db.prepare(`DELETE FROM tools_catalog`).run();
}
