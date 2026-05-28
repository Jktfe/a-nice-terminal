/**
 * lensTagRowsStore — Slice 5 of V2-server reframe (Phase A7).
 *
 * Per-tag verification rows for a lens. Replaces the rules_json blob
 * with first-class rows so each tag binding can be queried, authored,
 * and audited independently.
 *
 * Each row binds (lens, tag, expectation) plus the dispute policy +
 * verifier mix + weight that governs how the lens evaluates this tag
 * across multiple applications.
 *
 * **Expectations**:
 *   - `required` — lens fails unless this tag is applied
 *   - `forbidden` — lens fails when this tag IS applied
 *   - `consensus-required` — multiple verifiers must converge
 *   - `heuristic-allowed` — single verifier sufficient
 *   - `out-of-scope` — fragments with this tag are excluded from the lens
 *
 * **Dispute policies** (how disagreement between multiple applications
 * of the same tag resolves):
 *   - `majority` — >50% of applications win
 *   - `unanimous` — all applications must agree
 *   - `any-pass` — single passing application is enough
 *   - `any-fail` — single failing application sinks the lens
 *   - `escalate` — surface to human reviewer
 *
 * The existing `verification_lenses.rules_json` column stays as a
 * legacy read path; new authoring lands in lens_tag_rows. Migration
 * from rules_json → lens_tag_rows happens in a follow-up slice.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type LensTagExpectation =
  | 'required'
  | 'forbidden'
  | 'consensus-required'
  | 'heuristic-allowed'
  | 'out-of-scope';

export type LensTagDisputePolicy =
  | 'majority'
  | 'unanimous'
  | 'any-pass'
  | 'any-fail'
  | 'escalate';

export interface LensTagRow {
  id: string;
  lensId: string;
  tagId: string;
  /** Pins this row to a specific tag version; null = always use latest active. */
  tagVersion: number | null;
  expectation: LensTagExpectation;
  minVerifierCount: number;
  /**
   * Stored as JSON array of verifier-handle strings. Empty array means
   * any verifier is acceptable.
   */
  verifierMix: string[];
  disputePolicy: LensTagDisputePolicy;
  weight: number;
  notes: string | null;
  createdBy: string;
  createdAtMs: number;
}

export interface CreateLensTagRowInput {
  lensId: string;
  tagId: string;
  tagVersion?: number | null;
  expectation: LensTagExpectation;
  minVerifierCount?: number;
  verifierMix?: string[];
  disputePolicy?: LensTagDisputePolicy;
  weight?: number;
  notes?: string | null;
  createdBy: string;
}

function rowToLensTagRow(row: {
  id: string;
  lens_id: string;
  tag_id: string;
  tag_version: number | null;
  expectation: string;
  min_verifier_count: number;
  verifier_mix_json: string;
  dispute_policy: string;
  weight: number;
  notes: string | null;
  created_by: string;
  created_at_ms: number;
}): LensTagRow {
  return {
    id: row.id,
    lensId: row.lens_id,
    tagId: row.tag_id,
    tagVersion: row.tag_version,
    expectation: row.expectation as LensTagExpectation,
    minVerifierCount: row.min_verifier_count,
    verifierMix: JSON.parse(row.verifier_mix_json) as string[],
    disputePolicy: row.dispute_policy as LensTagDisputePolicy,
    weight: row.weight,
    notes: row.notes,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms
  };
}

export function createLensTagRow(input: CreateLensTagRowInput): LensTagRow {
  const db = getIdentityDb();
  // Verify the lens exists. Substrate refuses orphan rows.
  const lensExists = db
    .prepare(`SELECT 1 AS ok FROM verification_lenses WHERE id = ? LIMIT 1`)
    .get(input.lensId) as { ok: number } | undefined;
  if (!lensExists) {
    throw new Error(`createLensTagRow: lens ${input.lensId} does not exist`);
  }
  const id = `ltr-${randomUUID()}`;
  const createdAtMs = Date.now();
  const verifierMix = input.verifierMix ?? [];
  const minVerifierCount = input.minVerifierCount ?? 1;
  const disputePolicy = input.disputePolicy ?? 'majority';
  const weight = input.weight ?? 1.0;
  db.prepare(
    `INSERT INTO lens_tag_rows (
      id, lens_id, tag_id, tag_version, expectation,
      min_verifier_count, verifier_mix_json, dispute_policy, weight,
      notes, created_by, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.lensId,
    input.tagId,
    input.tagVersion ?? null,
    input.expectation,
    minVerifierCount,
    JSON.stringify(verifierMix),
    disputePolicy,
    weight,
    input.notes ?? null,
    input.createdBy,
    createdAtMs
  );
  return {
    id,
    lensId: input.lensId,
    tagId: input.tagId,
    tagVersion: input.tagVersion ?? null,
    expectation: input.expectation,
    minVerifierCount,
    verifierMix,
    disputePolicy,
    weight,
    notes: input.notes ?? null,
    createdBy: input.createdBy,
    createdAtMs
  };
}

export function listLensTagRows(lensId: string): LensTagRow[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM lens_tag_rows WHERE lens_id = ? ORDER BY created_at_ms ASC, rowid ASC`
    )
    .all(lensId) as Array<Parameters<typeof rowToLensTagRow>[0]>;
  return rows.map(rowToLensTagRow);
}

export function getLensTagRow(id: string): LensTagRow | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM lens_tag_rows WHERE id = ?`)
    .get(id) as Parameters<typeof rowToLensTagRow>[0] | undefined;
  return row ? rowToLensTagRow(row) : null;
}

export function deleteLensTagRow(id: string): boolean {
  const result = getIdentityDb()
    .prepare(`DELETE FROM lens_tag_rows WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

export function findLensTagRowsForTag(tagId: string): LensTagRow[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM lens_tag_rows WHERE tag_id = ? ORDER BY created_at_ms ASC, rowid ASC`
    )
    .all(tagId) as Array<Parameters<typeof rowToLensTagRow>[0]>;
  return rows.map(rowToLensTagRow);
}

export function resetLensTagRowsStoreForTests(): void {
  getIdentityDb().prepare('DELETE FROM lens_tag_rows').run();
}
