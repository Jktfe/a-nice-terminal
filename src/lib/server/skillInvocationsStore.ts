/**
 * skillInvocationsStore — Slice 11 of V2-server reframe (Phase B3 audit substrate).
 *
 * Append-only log of every skill invocation. Recorded fields:
 *   - caller identity (invoker_handle + invoker_kind + scope_id)
 *   - input (raw input_json + SHA-256 requirements_hash for dedup)
 *   - output (full output_json + extracted output_lens_id on success
 *     OR error_kind on refusal)
 *   - cost telemetry (model_used + cost_estimate_usd; populated when
 *     LLM call wires up in the next B3 slice)
 *
 * The cost cap + org-admin gate live in the API endpoint that calls
 * this store (B3 endpoint slice). This store enforces persistence
 * invariants only.
 */

import { randomUUID, createHash } from 'node:crypto';
import { getIdentityDb } from './db';

export type InvokerKind = 'human' | 'agent' | 'system';

export interface SkillInvocation {
  id: string;
  skillId: string;
  invokerHandle: string;
  invokerKind: InvokerKind;
  scopeId: string;
  inputRequirementsHash: string;
  inputJson: string;
  outputJson: string;
  outputLensId: string | null;
  errorKind: string | null;
  modelUsed: string | null;
  costEstimateUsd: number | null;
  invokedAtMs: number;
}

export interface RecordInvocationInput {
  skillId: string;
  invokerHandle: string;
  invokerKind: InvokerKind;
  scopeId: string;
  /**
   * The raw requirements string the caller supplied. Hashed via SHA-256
   * for the dedup index; raw text stored in input_json.
   */
  requirements: string;
  /** Full input object as the skill received it (JSON-serialised). */
  inputJson: string;
  /** Full output object the skill produced (JSON-serialised). */
  outputJson: string;
  /** Lens id from a successful output. Null when invocation refused. */
  outputLensId?: string | null;
  /** error_kind on refusal. Null on success. */
  errorKind?: string | null;
  modelUsed?: string | null;
  costEstimateUsd?: number | null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function rowToInvocation(row: {
  id: string;
  skill_id: string;
  invoker_handle: string;
  invoker_kind: string;
  scope_id: string;
  input_requirements_hash: string;
  input_json: string;
  output_json: string;
  output_lens_id: string | null;
  error_kind: string | null;
  model_used: string | null;
  cost_estimate_usd: number | null;
  invoked_at_ms: number;
}): SkillInvocation {
  return {
    id: row.id,
    skillId: row.skill_id,
    invokerHandle: row.invoker_handle,
    invokerKind: row.invoker_kind as InvokerKind,
    scopeId: row.scope_id,
    inputRequirementsHash: row.input_requirements_hash,
    inputJson: row.input_json,
    outputJson: row.output_json,
    outputLensId: row.output_lens_id,
    errorKind: row.error_kind,
    modelUsed: row.model_used,
    costEstimateUsd: row.cost_estimate_usd,
    invokedAtMs: row.invoked_at_ms
  };
}

/**
 * Record a skill invocation. Always succeeds — even refusals are
 * logged with `output_lens_id: null` + `error_kind: <kind>` so the
 * audit log captures the substrate's response to malformed input or
 * out-of-scope requests.
 */
export function recordSkillInvocation(input: RecordInvocationInput): SkillInvocation {
  const id = `skinv-${randomUUID()}`;
  const invokedAtMs = Date.now();
  const requirementsHash = sha256(input.requirements);
  getIdentityDb()
    .prepare(
      `INSERT INTO skill_invocations (
        id, skill_id, invoker_handle, invoker_kind, scope_id,
        input_requirements_hash, input_json, output_json,
        output_lens_id, error_kind, model_used, cost_estimate_usd,
        invoked_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.skillId,
      input.invokerHandle,
      input.invokerKind,
      input.scopeId,
      requirementsHash,
      input.inputJson,
      input.outputJson,
      input.outputLensId ?? null,
      input.errorKind ?? null,
      input.modelUsed ?? null,
      input.costEstimateUsd ?? null,
      invokedAtMs
    );
  return {
    id,
    skillId: input.skillId,
    invokerHandle: input.invokerHandle,
    invokerKind: input.invokerKind,
    scopeId: input.scopeId,
    inputRequirementsHash: requirementsHash,
    inputJson: input.inputJson,
    outputJson: input.outputJson,
    outputLensId: input.outputLensId ?? null,
    errorKind: input.errorKind ?? null,
    modelUsed: input.modelUsed ?? null,
    costEstimateUsd: input.costEstimateUsd ?? null,
    invokedAtMs
  };
}

export function getSkillInvocation(id: string): SkillInvocation | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM skill_invocations WHERE id = ?`)
    .get(id) as Parameters<typeof rowToInvocation>[0] | undefined;
  return row ? rowToInvocation(row) : null;
}

export interface ListInvocationsOptions {
  scopeId?: string;
  invokerHandle?: string;
  skillId?: string;
  /** Only return rows newer than this timestamp (ms). */
  since?: number;
  limit?: number;
}

export function listSkillInvocations(opts: ListInvocationsOptions = {}): SkillInvocation[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.scopeId) { clauses.push('scope_id = ?'); params.push(opts.scopeId); }
  if (opts.invokerHandle) { clauses.push('invoker_handle = ?'); params.push(opts.invokerHandle); }
  if (opts.skillId) { clauses.push('skill_id = ?'); params.push(opts.skillId); }
  if (opts.since !== undefined) { clauses.push('invoked_at_ms >= ?'); params.push(opts.since); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM skill_invocations ${where}
       ORDER BY invoked_at_ms DESC, rowid DESC
       LIMIT ?`
    )
    .all(...params, limit) as Array<Parameters<typeof rowToInvocation>[0]>;
  return rows.map(rowToInvocation);
}

/**
 * Cost summary for an org-scope over a window. Used by F2's
 * cost-cap gate (B3 endpoint slice).
 */
export interface CostSummary {
  invocationCount: number;
  refusalCount: number;
  totalCostUsd: number;
}

export function getScopeCostSummary(scopeId: string, sinceMs: number): CostSummary {
  const row = getIdentityDb()
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN error_kind IS NOT NULL THEN 1 ELSE 0 END) AS refusals,
        SUM(COALESCE(cost_estimate_usd, 0)) AS cost
       FROM skill_invocations
       WHERE scope_id = ? AND invoked_at_ms >= ?`
    )
    .get(scopeId, sinceMs) as { total: number; refusals: number; cost: number };
  return {
    invocationCount: row.total ?? 0,
    refusalCount: row.refusals ?? 0,
    totalCostUsd: row.cost ?? 0
  };
}

/**
 * Look up the most-recent invocation for a (scope, requirements_hash)
 * pair. Used by dedup logic — caller can choose to surface a "looks
 * identical to your last call X minutes ago" warning before burning a
 * fresh model call.
 */
export function findMostRecentForHash(
  scopeId: string,
  requirementsHash: string
): SkillInvocation | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT * FROM skill_invocations
       WHERE scope_id = ? AND input_requirements_hash = ?
       ORDER BY invoked_at_ms DESC, rowid DESC
       LIMIT 1`
    )
    .get(scopeId, requirementsHash) as Parameters<typeof rowToInvocation>[0] | undefined;
  return row ? rowToInvocation(row) : null;
}

export function resetSkillInvocationsStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM skill_invocations`).run();
}
