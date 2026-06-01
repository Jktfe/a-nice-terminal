/**
 * verificationVerdictsStore — Slice 6 of V2-server reframe (Phase A8).
 *
 * Append-only event log over `verification_observations`. Each call to
 * `recordVerdict()` INSERTs a new row; corrections never UPDATE. The
 * effective verdict per (lens_id, claim_anchor) is computed by walking
 * the chain newest-first via `getEffectiveVerdict()`.
 *
 * **Verdicts** (extension of the pre-refactor status enum):
 *   - `pending` / `running` — in-flight states (legacy, retained for
 *     compat; new verdict calls should use the terminal values below)
 *   - `passed` / `failed` / `waived` — legacy terminal states
 *   - `dispute` — verifier flagged disagreement; dispute_reason required
 *   - `insufficient_evidence` — verifier could not reach a confidence
 *     threshold; result_json captures evidence-gathering trace
 *   - `retag_required` — the underlying tag applications are stale or
 *     wrong; lens cannot evaluate until retagging completes
 *
 * **Chain semantics**:
 *   - The first observation for a (lens, claim) has `parent_observation_id = NULL`.
 *   - Subsequent verdicts set `parent_observation_id` to the prior one's id.
 *   - The effective verdict is the latest row (highest started_at_ms,
 *     rowid tie-break) per (lens_id, claim_anchor).
 *
 * **Audit-of-flagger**: verifier_handle + verifier_kind are recorded on
 * every row per JWPK 17-question ratification.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type VerdictStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'waived'
  | 'dispute'
  | 'insufficient_evidence'
  | 'retag_required';

export type VerifierKind = 'human' | 'agent' | 'system' | 'automated';

export interface VerificationVerdict {
  id: string;
  lensId: string;
  claimAnchor: string;
  claimText: string;
  status: VerdictStatus;
  score: number | null;
  resultJson: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  runBy: string | null;
  parentObservationId: string | null;
  verifierHandle: string | null;
  verifierKind: VerifierKind | null;
  disputeReason: string | null;
}

export interface RecordVerdictInput {
  lensId: string;
  claimAnchor: string;
  claimText: string;
  status: VerdictStatus;
  verifierHandle: string;
  verifierKind: VerifierKind;
  score?: number | null;
  resultJson?: string | null;
  parentObservationId?: string | null;
  disputeReason?: string | null;
  runBy?: string | null;
}

const TERMINAL_STATUSES = new Set<VerdictStatus>([
  'passed',
  'failed',
  'waived',
  'dispute',
  'insufficient_evidence',
  'retag_required'
]);

function rowToVerdict(row: {
  id: string;
  lens_id: string;
  claim_anchor: string;
  claim_text: string;
  status: string;
  score: number | null;
  result_json: string | null;
  started_at_ms: number;
  completed_at_ms: number | null;
  run_by: string | null;
  parent_observation_id: string | null;
  verifier_handle: string | null;
  verifier_kind: string | null;
  dispute_reason: string | null;
}): VerificationVerdict {
  return {
    id: row.id,
    lensId: row.lens_id,
    claimAnchor: row.claim_anchor,
    claimText: row.claim_text,
    status: row.status as VerdictStatus,
    score: row.score,
    resultJson: row.result_json,
    startedAtMs: row.started_at_ms,
    completedAtMs: row.completed_at_ms,
    runBy: row.run_by,
    parentObservationId: row.parent_observation_id,
    verifierHandle: row.verifier_handle,
    verifierKind: row.verifier_kind as VerifierKind | null,
    disputeReason: row.dispute_reason
  };
}

export function recordVerdict(input: RecordVerdictInput): VerificationVerdict {
  if (input.status === 'dispute' && !input.disputeReason?.trim()) {
    throw new Error("recordVerdict: dispute status requires disputeReason");
  }
  // Verify the lens exists. Substrate refuses orphan observations.
  const db = getIdentityDb();
  const lensExists = db
    .prepare(`SELECT 1 AS ok FROM verification_lenses WHERE id = ? LIMIT 1`)
    .get(input.lensId) as { ok: number } | undefined;
  if (!lensExists) {
    throw new Error(`recordVerdict: lens ${input.lensId} does not exist`);
  }
  // If parentObservationId is provided, verify it exists + matches the
  // same (lens_id, claim_anchor) so chain links can't cross claims.
  if (input.parentObservationId) {
    const parent = db
      .prepare(
        `SELECT lens_id, claim_anchor FROM verification_observations WHERE id = ?`
      )
      .get(input.parentObservationId) as
      | { lens_id: string; claim_anchor: string }
      | undefined;
    if (!parent) {
      throw new Error(
        `recordVerdict: parent observation ${input.parentObservationId} does not exist`
      );
    }
    if (parent.lens_id !== input.lensId || parent.claim_anchor !== input.claimAnchor) {
      throw new Error(
        `recordVerdict: parent observation belongs to a different (lens, claim) pair`
      );
    }
  }

  const id = `vobs-${randomUUID()}`;
  const startedAtMs = Date.now();
  const completedAtMs = TERMINAL_STATUSES.has(input.status) ? startedAtMs : null;
  db.prepare(
    `INSERT INTO verification_observations (
      id, lens_id, claim_anchor, claim_text, status, score, result_json,
      started_at_ms, completed_at_ms, run_by, parent_observation_id,
      verifier_handle, verifier_kind, dispute_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.lensId,
    input.claimAnchor,
    input.claimText,
    input.status,
    input.score ?? null,
    input.resultJson ?? null,
    startedAtMs,
    completedAtMs,
    input.runBy ?? input.verifierHandle,
    input.parentObservationId ?? null,
    input.verifierHandle,
    input.verifierKind,
    input.disputeReason ?? null
  );
  return {
    id,
    lensId: input.lensId,
    claimAnchor: input.claimAnchor,
    claimText: input.claimText,
    status: input.status,
    score: input.score ?? null,
    resultJson: input.resultJson ?? null,
    startedAtMs,
    completedAtMs,
    runBy: input.runBy ?? input.verifierHandle,
    parentObservationId: input.parentObservationId ?? null,
    verifierHandle: input.verifierHandle,
    verifierKind: input.verifierKind,
    disputeReason: input.disputeReason ?? null
  };
}

/**
 * Effective verdict for a (lens, claim) pair — the most recent
 * observation row. NULL if no observations exist yet.
 */
export function getEffectiveVerdict(
  lensId: string,
  claimAnchor: string
): VerificationVerdict | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT * FROM verification_observations
       WHERE lens_id = ? AND claim_anchor = ?
       ORDER BY started_at_ms DESC, rowid DESC
       LIMIT 1`
    )
    .get(lensId, claimAnchor) as Parameters<typeof rowToVerdict>[0] | undefined;
  return row ? rowToVerdict(row) : null;
}

/**
 * Full observation chain for a (lens, claim) pair — newest-first.
 * Used by the audit feed (per-claim history) + dispute resolution UI.
 */
export function listVerdictChain(
  lensId: string,
  claimAnchor: string
): VerificationVerdict[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM verification_observations
       WHERE lens_id = ? AND claim_anchor = ?
       ORDER BY started_at_ms DESC, rowid DESC`
    )
    .all(lensId, claimAnchor) as Array<Parameters<typeof rowToVerdict>[0]>;
  return rows.map(rowToVerdict);
}

/**
 * All verdicts authored by a specific verifier — audit view used by
 * the per-handler review tab in the Verification Tags page.
 */
export function listVerdictsByVerifier(
  verifierHandle: string,
  limit = 100
): VerificationVerdict[] {
  const capped = Math.max(1, Math.min(limit, 1000));
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM verification_observations
       WHERE verifier_handle = ?
       ORDER BY started_at_ms DESC, rowid DESC
       LIMIT ?`
    )
    .all(verifierHandle, capped) as Array<Parameters<typeof rowToVerdict>[0]>;
  return rows.map(rowToVerdict);
}

/**
 * Disputed verdicts across all claims for a lens — used by the lens
 * owner's "needs attention" queue.
 */
export function listDisputesForLens(lensId: string): VerificationVerdict[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM verification_observations
       WHERE lens_id = ? AND status = 'dispute'
       ORDER BY started_at_ms DESC, rowid DESC`
    )
    .all(lensId) as Array<Parameters<typeof rowToVerdict>[0]>;
  return rows.map(rowToVerdict);
}

export function getVerdict(id: string): VerificationVerdict | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM verification_observations WHERE id = ?`)
    .get(id) as Parameters<typeof rowToVerdict>[0] | undefined;
  return row ? rowToVerdict(row) : null;
}

export function resetVerificationVerdictsStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM verification_observations`).run();
}
