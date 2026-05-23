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
  rulesJson: string;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
};

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
  schema: Omit<ValidationSchema, 'createdAtMs' | 'updatedAtMs'>
): ValidationSchema {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO validation_schemas
       (id, name, description, lens_kind, rules_json, created_by, created_at_ms, updated_at_ms, archived_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schema.id, schema.name, schema.description ?? null, schema.lensKind,
    schema.rulesJson, schema.createdBy ?? null, now, now, schema.archivedAtMs ?? null
  );
  return { ...schema, createdAtMs: now, updatedAtMs: now };
}

export function listValidationSchemas(includeArchived = false): ValidationSchema[] {
  const db = getIdentityDb();
  const sql = includeArchived
    ? `SELECT * FROM validation_schemas ORDER BY created_at_ms DESC`
    : `SELECT * FROM validation_schemas WHERE archived_at_ms IS NULL ORDER BY created_at_ms DESC`;
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
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
  const schemas: Omit<ValidationSchema, 'createdAtMs' | 'updatedAtMs'>[] = [
    { id: 'lens-poc', name: 'Proof of Concept', description: 'Early-stage validation for prototypes.', lensKind: 'poc', rulesJson: '[]', createdBy: '@system', archivedAtMs: null },
    { id: 'lens-fca', name: 'FCA Compliance', description: 'Financial Conduct Authority validation.', lensKind: 'fca', rulesJson: '[]', createdBy: '@system', archivedAtMs: null },
    { id: 'lens-investment', name: 'Investment Memo', description: 'Investment committee validation.', lensKind: 'investment_memo', rulesJson: '[]', createdBy: '@system', archivedAtMs: null },
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
