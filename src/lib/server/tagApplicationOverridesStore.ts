/**
 * tagApplicationOverridesStore — Slice 4 of V2-server reframe (Phase A5).
 *
 * Per-application overrides for tag_applications. Three kinds:
 *
 * 1. **classification** — change the verification protocol class for
 *    this specific application (e.g. demote `consensus-required` to
 *    `heuristic` when context warrants).
 *
 * 2. **flag_ignorable** — mark this application as ignorable. Verification
 *    readers skip ignorable applications during lens evaluation. Use for
 *    "this is a joke claim, not a real one" / "this is an example, not
 *    an actual assertion" cases.
 *
 * 3. **withdraw** — withdraw a previous override on the same application,
 *    reverting to the prior override (or original if none).
 *
 * **Invariants**:
 *
 * - Append-only. Every override is a new row. Mistakes are corrected by
 *   adding a `withdraw` override, never by deleting.
 *
 * - `reason` is REQUIRED on every row (audit-of-flagger per JWPK
 *   ratification). The store throws if reason is empty/whitespace.
 *
 * - Effective state is computed by walking the override chain newest-
 *   first via `getEffectiveOverride()`. The most-recent non-withdrawn
 *   override wins; a `withdraw` override pops the prior one.
 *
 * - Override is scoped to ONE tag_application. It never mutates the
 *   tag definition — that's governed separately by editTag in
 *   verificationTaxonomyStore (org-admin authority).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import type { VerificationProtocolClass, TagActorKind } from './verificationTaxonomyStore';

// ───────────────────────── types ─────────────────────────

export type OverrideKind = 'classification' | 'flag_ignorable' | 'withdraw';

export interface TagApplicationOverride {
  id: string;
  tagApplicationId: string;
  overrideKind: OverrideKind;
  /** Set when overrideKind === 'classification'; null otherwise. */
  newProtocolClass: VerificationProtocolClass | null;
  handlerHandle: string;
  handlerKind: TagActorKind;
  reason: string;
  createdAtMs: number;
}

export interface RecordOverrideInput {
  tagApplicationId: string;
  overrideKind: OverrideKind;
  newProtocolClass?: VerificationProtocolClass | null;
  handlerHandle: string;
  handlerKind: TagActorKind;
  reason: string;
}

/**
 * The effective override on a tag_application — the result of walking
 * the override chain. Null means "no active overrides, use the
 * application as-applied".
 */
export type EffectiveOverride =
  | { kind: 'classification'; newProtocolClass: VerificationProtocolClass; reason: string; handlerHandle: string; createdAtMs: number }
  | { kind: 'flag_ignorable'; reason: string; handlerHandle: string; createdAtMs: number }
  | null;

// ───────────────────────── helpers ─────────────────────────

function nowMs(): number {
  return Date.now();
}

function rowToOverride(row: {
  id: string;
  tag_application_id: string;
  override_kind: string;
  new_protocol_class: string | null;
  handler_handle: string;
  handler_kind: string;
  reason: string;
  created_at_ms: number;
}): TagApplicationOverride {
  return {
    id: row.id,
    tagApplicationId: row.tag_application_id,
    overrideKind: row.override_kind as OverrideKind,
    newProtocolClass: row.new_protocol_class as VerificationProtocolClass | null,
    handlerHandle: row.handler_handle,
    handlerKind: row.handler_kind as TagActorKind,
    reason: row.reason,
    createdAtMs: row.created_at_ms
  };
}

// ───────────────────────── ops ─────────────────────────

export function recordTagApplicationOverride(
  input: RecordOverrideInput
): TagApplicationOverride {
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    throw new Error('recordTagApplicationOverride: reason is required');
  }
  if (input.overrideKind === 'classification' && !input.newProtocolClass) {
    throw new Error(
      "recordTagApplicationOverride: newProtocolClass required for kind='classification'"
    );
  }
  if (input.overrideKind !== 'classification' && input.newProtocolClass) {
    throw new Error(
      "recordTagApplicationOverride: newProtocolClass is only valid for kind='classification'"
    );
  }
  // Verify the tag_application exists. The substrate refuses overrides
  // against missing applications because the override has no anchor.
  const exists = getIdentityDb()
    .prepare(`SELECT 1 AS ok FROM tag_applications WHERE id = ? LIMIT 1`)
    .get(input.tagApplicationId) as { ok: number } | undefined;
  if (!exists) {
    throw new Error(
      `recordTagApplicationOverride: tag_application ${input.tagApplicationId} does not exist`
    );
  }

  const id = `tovr-${randomUUID()}`;
  const createdAtMs = nowMs();
  getIdentityDb()
    .prepare(
      `INSERT INTO tag_application_overrides (
        id, tag_application_id, override_kind, new_protocol_class,
        handler_handle, handler_kind, reason, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.tagApplicationId,
      input.overrideKind,
      input.newProtocolClass ?? null,
      input.handlerHandle,
      input.handlerKind,
      reason,
      createdAtMs
    );

  return {
    id,
    tagApplicationId: input.tagApplicationId,
    overrideKind: input.overrideKind,
    newProtocolClass: input.newProtocolClass ?? null,
    handlerHandle: input.handlerHandle,
    handlerKind: input.handlerKind,
    reason,
    createdAtMs
  };
}

export function listOverridesForApplication(
  tagApplicationId: string
): TagApplicationOverride[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tag_application_overrides
       WHERE tag_application_id = ?
       ORDER BY created_at_ms DESC, rowid DESC`
    )
    .all(tagApplicationId) as Array<Parameters<typeof rowToOverride>[0]>;
  return rows.map(rowToOverride);
}

/**
 * Walks the override chain newest-first to compute the effective state.
 *
 * Rules:
 *   - No overrides → null (use application as-applied).
 *   - Most recent is `classification` → that class wins.
 *   - Most recent is `flag_ignorable` → application is ignored.
 *   - Most recent is `withdraw` → it cancels the next-most-recent
 *     non-withdraw override; recursion continues with that prior
 *     popped. Stacked withdraws pop multiple times.
 */
export function getEffectiveOverride(tagApplicationId: string): EffectiveOverride {
  const chain = listOverridesForApplication(tagApplicationId);
  // Walk newest-first, popping pairs of (withdraw, prior).
  let withdrawDebt = 0;
  for (const ov of chain) {
    if (ov.overrideKind === 'withdraw') {
      withdrawDebt += 1;
      continue;
    }
    if (withdrawDebt > 0) {
      // This non-withdraw override is cancelled by an earlier withdraw.
      withdrawDebt -= 1;
      continue;
    }
    // Found the live override.
    if (ov.overrideKind === 'classification') {
      return {
        kind: 'classification',
        newProtocolClass: ov.newProtocolClass!,
        reason: ov.reason,
        handlerHandle: ov.handlerHandle,
        createdAtMs: ov.createdAtMs
      };
    }
    if (ov.overrideKind === 'flag_ignorable') {
      return {
        kind: 'flag_ignorable',
        reason: ov.reason,
        handlerHandle: ov.handlerHandle,
        createdAtMs: ov.createdAtMs
      };
    }
  }
  return null;
}

export interface ListByHandlerOptions {
  limit?: number;
  since?: number;
}

export function listOverridesByHandler(
  handlerHandle: string,
  opts: ListByHandlerOptions = {}
): TagApplicationOverride[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  const since = opts.since ?? 0;
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tag_application_overrides
       WHERE handler_handle = ? AND created_at_ms >= ?
       ORDER BY created_at_ms DESC, rowid DESC
       LIMIT ?`
    )
    .all(handlerHandle, since, limit) as Array<Parameters<typeof rowToOverride>[0]>;
  return rows.map(rowToOverride);
}

// ───────────────────────── test helpers ─────────────────────────

export function resetTagApplicationOverridesStoreForTests(): void {
  getIdentityDb().prepare('DELETE FROM tag_application_overrides').run();
}
