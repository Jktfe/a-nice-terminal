/**
 * validationLensStore — per-user validation schemas + runs.
 *
 * A lens is a named validation schema (POC, FCA, investment-memo, etc).
 * validation_runs tracks per-claim-anchor evaluations against a lens.
 *
 * Tables: validation_schemas, validation_runs (defined in db.ts).
 */

import { getIdentityDb } from './db';

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

export function createValidationSchema(
  schema: CreateValidationSchemaInput
): ValidationSchema {
  const db = getIdentityDb();
  const now = Date.now();
  const scope = schema.scope ?? 'public';
  const scopeId = schema.scopeId ?? 'global';
  db.prepare(
    `INSERT INTO validation_schemas
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
    `SELECT * FROM validation_schemas ${where} ORDER BY created_at_ms DESC`
  ).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowFromSchema);
}

export function getValidationSchema(id: string): ValidationSchema | null {
  const db = getIdentityDb();
  const row = db.prepare('SELECT * FROM validation_schemas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowFromSchema(row) : null;
}

export function archiveValidationSchema(id: string): void {
  const db = getIdentityDb();
  db.prepare('UPDATE validation_schemas SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?').run(Date.now(), Date.now(), id);
}

export function createValidationRun(
  run: Omit<ValidationRun, 'startedAtMs' | 'completedAtMs'>
): ValidationRun {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO validation_runs
       (id, schema_id, claim_anchor, claim_text, status, score, result_json, started_at_ms, completed_at_ms, run_by)
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
    `UPDATE validation_runs SET status = ?, score = ?, result_json = ?, completed_at_ms = ? WHERE id = ?`
  ).run(status, score ?? null, resultJson ?? null, Date.now(), id);
}

export function listValidationRunsForClaim(claimAnchor: string): ValidationRun[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT * FROM validation_runs WHERE claim_anchor = ? ORDER BY completed_at_ms DESC`
  ).all(claimAnchor) as Array<Record<string, unknown>>;
  return rows.map(rowFromRun);
}

export function listValidationRunsForSchema(schemaId: string): ValidationRun[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT * FROM validation_runs WHERE schema_id = ? ORDER BY started_at_ms DESC`
  ).all(schemaId) as Array<Record<string, unknown>>;
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

function rowFromRun(row: Record<string, unknown>): ValidationRun {
  return {
    id: String(row.id),
    schemaId: String(row.schema_id),
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
