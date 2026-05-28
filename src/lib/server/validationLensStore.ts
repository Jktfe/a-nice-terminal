/**
 * validationLensStore — per-user validation schemas + runs.
 *
 * A lens is a named validation schema (POC, FCA, investment-memo, etc).
 * verification_observations tracks per-claim-anchor evaluations against a lens.
 *
 * Tables: verification_lenses, verification_observations (defined in db.ts).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import type { PolicyActorKind } from './policyStore';

export type ValidationSchema = {
  id: string;
  name: string;
  description: string | null;
  lensKind: 'poc' | 'fca' | 'investment_memo' | 'scientific_claim' | 'marketing_copy' | 'custom';
  scope: ValidationSchemaScope;
  scopeId: string;
  rulesJson: string;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
};

export type ValidationSchemaScope = 'org' | 'user' | 'public';

export type ValidationSchemaVisibility = {
  isAdmin: boolean;
  handles?: string[];
  orgId?: string;
};

export type ListValidationSchemasOptions = {
  includeArchived?: boolean;
  visibleTo?: ValidationSchemaVisibility;
};

export type CreateValidationSchemaInput =
  Omit<ValidationSchema, 'createdAtMs' | 'updatedAtMs' | 'scope' | 'scopeId'>
  & Partial<Pick<ValidationSchema, 'scope' | 'scopeId'>>;

export type ValidationRun = {
  id: string;
  schemaId: string;
  claimAnchor: string;
  claimText: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'waived';
  score: number | null;
  resultJson: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  runBy: string | null;
};

export type ValidationSchemaAuditAction = 'create' | 'update' | 'archive';

export type ValidationSchemaAuditEntry = {
  id: string;
  schemaId: string;
  actorHandle: string;
  actorKind: PolicyActorKind;
  action: ValidationSchemaAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAtMs: number;
};

export function createValidationSchema(
  schema: CreateValidationSchemaInput
): ValidationSchema {
  const db = getIdentityDb();
  const now = Date.now();
  const scope = schema.scope ?? 'public';
  const scopeId = schema.scopeId ?? 'global';
  db.prepare(
    `INSERT INTO verification_lenses
       (id, name, description, lens_kind, scope, scope_id, rules_json, created_by, created_at_ms, updated_at_ms, archived_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schema.id, schema.name, schema.description ?? null, schema.lensKind,
    scope, scopeId,
    schema.rulesJson, schema.createdBy ?? null, now, now, schema.archivedAtMs ?? null
  );
  return { ...schema, scope, scopeId, createdAtMs: now, updatedAtMs: now };
}

export function listValidationSchemas(options: boolean | ListValidationSchemasOptions = false): ValidationSchema[] {
  const db = getIdentityDb();
  const includeArchived = typeof options === 'boolean'
    ? options
    : options.includeArchived === true;
  const visibleTo = typeof options === 'boolean' ? undefined : options.visibleTo;
  const conditions: string[] = [];
  const params: string[] = [];

  if (!includeArchived) {
    conditions.push('archived_at_ms IS NULL');
  }

  if (visibleTo && !visibleTo.isAdmin) {
    const visibilityClauses = ['scope = ?'];
    params.push('public');

    const handles = [...new Set(visibleTo.handles ?? [])].filter((handle) => handle.trim().length > 0);
    if (handles.length > 0) {
      visibilityClauses.push(`(scope = ? AND scope_id IN (${handles.map(() => '?').join(', ')}))`);
      params.push('user', ...handles);
    }
    if (visibleTo.orgId && visibleTo.orgId.trim().length > 0) {
      visibilityClauses.push('(scope = ? AND scope_id = ?)');
      params.push('org', visibleTo.orgId.trim());
    }
    conditions.push(`(${visibilityClauses.join(' OR ')})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM verification_lenses ${where} ORDER BY created_at_ms DESC`
  ).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowFromSchema);
}

export function getValidationSchema(id: string): ValidationSchema | null {
  const db = getIdentityDb();
  const row = db.prepare('SELECT * FROM verification_lenses WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowFromSchema(row) : null;
}

export function updateValidationSchema(input: {
  id: string;
  name?: string;
  description?: string | null;
  lensKind?: ValidationSchema['lensKind'];
  scope?: ValidationSchemaScope;
  scopeId?: string;
  rulesJson?: string;
  actorHandle: string;
  actorKind: PolicyActorKind;
  reason?: string | null;
  nowMs?: number;
}): ValidationSchema | null {
  const existing = getValidationSchema(input.id);
  if (!existing || existing.archivedAtMs !== null) return null;
  const db = getIdentityDb();
  const now = input.nowMs ?? Date.now();
  const next = {
    name: input.name !== undefined ? input.name.trim() : existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    lensKind: input.lensKind ?? existing.lensKind,
    scope: input.scope ?? existing.scope,
    scopeId: input.scopeId ?? existing.scopeId,
    rulesJson: input.rulesJson ?? existing.rulesJson
  };
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE verification_lenses
         SET name = ?, description = ?, lens_kind = ?, scope = ?, scope_id = ?, rules_json = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(next.name, next.description, next.lensKind, next.scope, next.scopeId, next.rulesJson, now, existing.id);
    recordValidationSchemaAudit({
      schemaId: existing.id,
      actorHandle: input.actorHandle,
      actorKind: input.actorKind,
      action: 'update',
      before: schemaAuditBody(existing),
      after: { id: existing.id, ...next },
      reason: input.reason ?? null,
      nowMs: now
    });
  });
  txn();
  return getValidationSchema(existing.id);
}

export function archiveValidationSchema(id: string): void {
  const db = getIdentityDb();
  db.prepare('UPDATE verification_lenses SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?').run(Date.now(), Date.now(), id);
}

export function archiveValidationSchemaWithAudit(input: {
  id: string;
  actorHandle: string;
  actorKind: PolicyActorKind;
  reason?: string | null;
  nowMs?: number;
}): boolean {
  const existing = getValidationSchema(input.id);
  if (!existing || existing.archivedAtMs !== null) return false;
  const db = getIdentityDb();
  const now = input.nowMs ?? Date.now();
  const txn = db.transaction(() => {
    db.prepare('UPDATE verification_lenses SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?').run(now, now, input.id);
    recordValidationSchemaAudit({
      schemaId: input.id,
      actorHandle: input.actorHandle,
      actorKind: input.actorKind,
      action: 'archive',
      before: schemaAuditBody(existing),
      after: null,
      reason: input.reason ?? null,
      nowMs: now
    });
  });
  txn();
  return true;
}

export function recordValidationSchemaAudit(input: {
  schemaId: string;
  actorHandle: string;
  actorKind: PolicyActorKind;
  action: ValidationSchemaAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  nowMs?: number;
}): void {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO verification_lens_audit
       (id, lens_id, actor_handle, actor_kind, action, before_json, after_json, reason, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.schemaId,
    input.actorHandle,
    input.actorKind,
    input.action,
    input.before === undefined || input.before === null ? null : JSON.stringify(input.before),
    input.after === undefined || input.after === null ? null : JSON.stringify(input.after),
    input.reason ?? null,
    input.nowMs ?? Date.now()
  );
}

export function listValidationSchemaAuditForSchema(schemaId: string): ValidationSchemaAuditEntry[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT * FROM verification_lens_audit WHERE lens_id = ? ORDER BY created_at_ms DESC, rowid DESC`
  ).all(schemaId) as Array<Record<string, unknown>>;
  return rows.map(rowFromSchemaAudit);
}

export function createValidationRun(
  run: Omit<ValidationRun, 'startedAtMs' | 'completedAtMs'>
): ValidationRun {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO verification_observations
       (id, lens_id, claim_anchor, claim_text, status, score, result_json, started_at_ms, completed_at_ms, run_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.id, run.schemaId, run.claimAnchor, run.claimText,
    run.status, run.score ?? null, run.resultJson ?? null, now, null, run.runBy ?? null
  );
  return { ...run, startedAtMs: now, completedAtMs: null };
}

export function completeValidationRun(
  id: string,
  status: 'passed' | 'failed' | 'waived',
  score?: number,
  resultJson?: string
): void {
  const db = getIdentityDb();
  db.prepare(
    `UPDATE verification_observations SET status = ?, score = ?, result_json = ?, completed_at_ms = ? WHERE id = ?`
  ).run(status, score ?? null, resultJson ?? null, Date.now(), id);
}

export function listValidationRunsForClaim(claimAnchor: string): ValidationRun[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT * FROM verification_observations WHERE claim_anchor = ? ORDER BY completed_at_ms DESC`
  ).all(claimAnchor) as Array<Record<string, unknown>>;
  return rows.map(rowFromRun);
}

export function listValidationRunsForSchema(schemaId: string): ValidationRun[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT * FROM verification_observations WHERE lens_id = ? ORDER BY started_at_ms DESC`
  ).all(schemaId) as Array<Record<string, unknown>>;
  return rows.map(rowFromRun);
}

/**
 * List validation runs whose claim_anchor sits under any of the supplied
 * artefact ids (i.e. claim_anchor LIKE 'artefact:<id>%'). Used by the
 * per-room validation-summary endpoint (V3 contract) to aggregate runs
 * across every artefact in a room without re-extracting claims per call.
 *
 * `sinceMs` optionally restricts to runs whose started_at_ms is at or
 * after that timestamp — typical use: last 7 days.
 *
 * Returns runs ordered by started_at_ms DESC (newest first).
 */
export function listValidationRunsForArtefacts(
  artefactIds: readonly string[],
  sinceMs?: number
): ValidationRun[] {
  if (artefactIds.length === 0) return [];
  const db = getIdentityDb();
  const likeClauses = artefactIds.map(() => `claim_anchor LIKE ?`).join(' OR ');
  const params: unknown[] = artefactIds.map((id) => `artefact:${id}%`);
  let sql = `SELECT * FROM verification_observations WHERE (${likeClauses})`;
  if (sinceMs !== undefined) {
    sql += ` AND started_at_ms >= ?`;
    params.push(sinceMs);
  }
  sql += ` ORDER BY started_at_ms DESC`;
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowFromRun);
}

// ─── Seed data ───

export function seedValidationSchemas(): void {
  const schemas: CreateValidationSchemaInput[] = [
    { id: 'lens-poc', name: 'Proof of Concept', description: 'Early-stage validation for prototypes.', lensKind: 'poc', scope: 'public', scopeId: 'global', rulesJson: '[]', createdBy: '@system', archivedAtMs: null },
    { id: 'lens-fca', name: 'FCA Compliance', description: 'Financial Conduct Authority validation.', lensKind: 'fca', scope: 'public', scopeId: 'global', rulesJson: '[]', createdBy: '@system', archivedAtMs: null },
    { id: 'lens-investment', name: 'Investment Memo', description: 'Investment committee validation.', lensKind: 'investment_memo', scope: 'public', scopeId: 'global', rulesJson: '[]', createdBy: '@system', archivedAtMs: null },
  ];
  for (const s of schemas) {
    const existing = getValidationSchema(s.id);
    if (!existing) {
      createValidationSchema(s);
    }
  }
}

// ─── Row mappers ───

function rowFromSchema(row: Record<string, unknown>): ValidationSchema {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    lensKind: String(row.lens_kind) as ValidationSchema['lensKind'],
    scope: String(row.scope ?? 'public') as ValidationSchemaScope,
    scopeId: String(row.scope_id ?? 'global'),
    rulesJson: String(row.rules_json),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    archivedAtMs: row.archived_at_ms == null ? null : Number(row.archived_at_ms),
  };
}

function schemaAuditBody(schema: ValidationSchema): Record<string, unknown> {
  return {
    id: schema.id,
    name: schema.name,
    description: schema.description,
    lensKind: schema.lensKind,
    scope: schema.scope,
    scopeId: schema.scopeId,
    rulesJson: schema.rulesJson
  };
}

function parseAuditJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* malformed audit json */ }
  return null;
}

function rowFromSchemaAudit(row: Record<string, unknown>): ValidationSchemaAuditEntry {
  return {
    id: String(row.id),
    schemaId: String(row.lens_id),
    actorHandle: String(row.actor_handle),
    actorKind: String(row.actor_kind) as PolicyActorKind,
    action: String(row.action) as ValidationSchemaAuditAction,
    before: parseAuditJson(row.before_json),
    after: parseAuditJson(row.after_json),
    reason: row.reason == null ? null : String(row.reason),
    createdAtMs: Number(row.created_at_ms)
  };
}

function rowFromRun(row: Record<string, unknown>): ValidationRun {
  return {
    id: String(row.id),
    schemaId: String(row.lens_id),
    claimAnchor: String(row.claim_anchor),
    claimText: String(row.claim_text),
    status: String(row.status) as ValidationRun['status'],
    score: row.score == null ? null : Number(row.score),
    resultJson: row.result_json == null ? null : String(row.result_json),
    startedAtMs: Number(row.started_at_ms),
    completedAtMs: row.completed_at_ms == null ? null : Number(row.completed_at_ms),
    runBy: row.run_by == null ? null : String(row.run_by),
  };
}
