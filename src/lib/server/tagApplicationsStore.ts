/**
 * tagApplicationsStore — Slice 3 of V2-server reframe (Phase A3 + A4).
 *
 * Three primitives:
 *
 * 1. **tagging_anchors** — content-type-agnostic anchor records. Tag
 *    applications bind to anchors instead of raw byte offsets so the
 *    substrate stays adapter-shaped. The store accepts arbitrary
 *    `anchorDataJson` payloads; adapter modules outside the substrate
 *    (univer-block / markdown-offset / pdf-region / image-region /
 *    audio-timestamp / message-range / file-checksum) interpret them.
 *
 * 2. **tag_applications** — immutable "tag X applied to anchor Y by
 *    Z at T" records. Each carries (tag_id, tag_version) so historical
 *    applications resolve against their original definition even after
 *    the tag is edited (load-bearing for replayable audit).
 *
 * 3. **tagging_runs** — grouping primitive. One `ant tags apply`
 *    invocation creates one run, then writes N tag_applications that
 *    share `tagging_run_id`. The UI lists runs (latest-first) and
 *    drills into the applications produced by each.
 *
 * **Key invariants**:
 *
 * - tag_applications are append-only. Corrections happen via Slice 4
 *   (tag_application_overrides), never via mutation.
 *
 * - content_hash on the anchor is the re-verification trigger:
 *   when an artefact's hash diverges from the anchor's hash, any
 *   lens with re_verification_on_content_change=true re-runs the
 *   affected applications.
 *
 * - Relational tag applications (e.g. source.supports-claim.<claimId>)
 *   carry the parameterised tag_id AND set target_claim_id. Readers
 *   reconstruct the relationship from both.
 *
 * - A tagging_run can be started and never completed (process crash,
 *   user abandon). completed_at_ms is NULL until completeTaggingRun
 *   is called; in-flight runs are visible to listRunsForScope.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

// ───────────────────────── types ─────────────────────────

export type AnchorContentKind =
  | 'univer-block'
  | 'markdown-offset'
  | 'pdf-region'
  | 'image-region'
  | 'audio-timestamp'
  | 'message-range'
  | 'file-checksum';

export type ApplicatorKind = 'human' | 'agent' | 'system';

export type TaggingRunScopeKind = 'artefact' | 'message' | 'file' | 'document' | 'room';

export interface TaggingAnchor {
  id: string;
  contentKind: AnchorContentKind;
  contentId: string;
  contentHash: string;
  /**
   * Adapter-specific payload. The substrate treats this as opaque JSON
   * and never parses it — adapter modules interpret per content_kind.
   */
  anchorData: unknown;
  createdBy: string;
  createdAtMs: number;
}

export interface TagApplication {
  id: string;
  tagId: string;
  tagVersion: number;
  targetAnchorId: string;
  /** Non-null only for relational tags (source.supports-claim.<id> etc) */
  targetClaimId: string | null;
  applicatorHandle: string;
  applicatorKind: ApplicatorKind;
  appliedReason: string | null;
  taggingRunId: string;
  appliedAtMs: number;
}

export interface TaggingRun {
  id: string;
  scopeId: string;
  scopeKind: TaggingRunScopeKind;
  initiatorHandle: string;
  initiatorKind: ApplicatorKind;
  runReason: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  applicationCount: number;
}

// ───────────────────────── inputs ─────────────────────────

export interface CreateTaggingAnchorInput {
  contentKind: AnchorContentKind;
  contentId: string;
  contentHash: string;
  anchorData: unknown;
  createdBy: string;
}

export interface StartTaggingRunInput {
  scopeId: string;
  scopeKind: TaggingRunScopeKind;
  initiatorHandle: string;
  initiatorKind: ApplicatorKind;
  runReason?: string | null;
}

export interface ApplyTagInput {
  tagId: string;
  tagVersion: number;
  targetAnchorId: string;
  targetClaimId?: string | null;
  applicatorHandle: string;
  applicatorKind: ApplicatorKind;
  appliedReason?: string | null;
  taggingRunId: string;
}

// ───────────────────────── helpers ─────────────────────────

function nowMs(): number {
  return Date.now();
}

function rowToAnchor(row: {
  id: string;
  content_kind: string;
  content_id: string;
  content_hash: string;
  anchor_data_json: string;
  created_by: string;
  created_at_ms: number;
}): TaggingAnchor {
  return {
    id: row.id,
    contentKind: row.content_kind as AnchorContentKind,
    contentId: row.content_id,
    contentHash: row.content_hash,
    anchorData: JSON.parse(row.anchor_data_json),
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms
  };
}

function rowToApplication(row: {
  id: string;
  tag_id: string;
  tag_version: number;
  target_anchor_id: string;
  target_claim_id: string | null;
  applicator_handle: string;
  applicator_kind: string;
  applied_reason: string | null;
  tagging_run_id: string;
  applied_at_ms: number;
}): TagApplication {
  return {
    id: row.id,
    tagId: row.tag_id,
    tagVersion: row.tag_version,
    targetAnchorId: row.target_anchor_id,
    targetClaimId: row.target_claim_id,
    applicatorHandle: row.applicator_handle,
    applicatorKind: row.applicator_kind as ApplicatorKind,
    appliedReason: row.applied_reason,
    taggingRunId: row.tagging_run_id,
    appliedAtMs: row.applied_at_ms
  };
}

function rowToRun(row: {
  id: string;
  scope_id: string;
  scope_kind: string;
  initiator_handle: string;
  initiator_kind: string;
  run_reason: string | null;
  started_at_ms: number;
  completed_at_ms: number | null;
  application_count: number;
}): TaggingRun {
  return {
    id: row.id,
    scopeId: row.scope_id,
    scopeKind: row.scope_kind as TaggingRunScopeKind,
    initiatorHandle: row.initiator_handle,
    initiatorKind: row.initiator_kind as ApplicatorKind,
    runReason: row.run_reason,
    startedAtMs: row.started_at_ms,
    completedAtMs: row.completed_at_ms,
    applicationCount: row.application_count
  };
}

// ───────────────────────── anchor ops ─────────────────────────

export function createTaggingAnchor(input: CreateTaggingAnchorInput): TaggingAnchor {
  const db = getIdentityDb();
  const id = `anchor-${randomUUID()}`;
  const createdAtMs = nowMs();
  db.prepare(
    `INSERT INTO tagging_anchors (
      id, content_kind, content_id, content_hash, anchor_data_json,
      created_by, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.contentKind,
    input.contentId,
    input.contentHash,
    JSON.stringify(input.anchorData),
    input.createdBy,
    createdAtMs
  );
  return {
    id,
    contentKind: input.contentKind,
    contentId: input.contentId,
    contentHash: input.contentHash,
    anchorData: input.anchorData,
    createdBy: input.createdBy,
    createdAtMs
  };
}

export function getTaggingAnchor(id: string): TaggingAnchor | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM tagging_anchors WHERE id = ?`)
    .get(id) as Parameters<typeof rowToAnchor>[0] | undefined;
  return row ? rowToAnchor(row) : null;
}

export function listAnchorsForContent(
  contentId: string,
  contentKind?: AnchorContentKind
): TaggingAnchor[] {
  const db = getIdentityDb();
  const rows = contentKind
    ? (db
        .prepare(
          `SELECT * FROM tagging_anchors WHERE content_id = ? AND content_kind = ? ORDER BY created_at_ms ASC, rowid ASC`
        )
        .all(contentId, contentKind) as Array<Parameters<typeof rowToAnchor>[0]>)
    : (db
        .prepare(
          `SELECT * FROM tagging_anchors WHERE content_id = ? ORDER BY created_at_ms ASC, rowid ASC`
        )
        .all(contentId) as Array<Parameters<typeof rowToAnchor>[0]>);
  return rows.map(rowToAnchor);
}

/**
 * Find anchors whose content_hash differs from the current hash —
 * these are the anchors that need re-verification after a content
 * change. Caller computes currentHash from the artefact source.
 */
export function listStaleAnchors(
  contentId: string,
  currentHash: string
): TaggingAnchor[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tagging_anchors WHERE content_id = ? AND content_hash != ? ORDER BY created_at_ms ASC`
    )
    .all(contentId, currentHash) as Array<Parameters<typeof rowToAnchor>[0]>;
  return rows.map(rowToAnchor);
}

// ───────────────────────── run ops ─────────────────────────

export function startTaggingRun(input: StartTaggingRunInput): TaggingRun {
  const db = getIdentityDb();
  const id = `trun-${randomUUID()}`;
  const startedAtMs = nowMs();
  db.prepare(
    `INSERT INTO tagging_runs (
      id, scope_id, scope_kind, initiator_handle, initiator_kind,
      run_reason, started_at_ms, completed_at_ms, application_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)`
  ).run(
    id,
    input.scopeId,
    input.scopeKind,
    input.initiatorHandle,
    input.initiatorKind,
    input.runReason ?? null,
    startedAtMs
  );
  return {
    id,
    scopeId: input.scopeId,
    scopeKind: input.scopeKind,
    initiatorHandle: input.initiatorHandle,
    initiatorKind: input.initiatorKind,
    runReason: input.runReason ?? null,
    startedAtMs,
    completedAtMs: null,
    applicationCount: 0
  };
}

export function completeTaggingRun(runId: string): TaggingRun | null {
  const db = getIdentityDb();
  const completedAtMs = nowMs();
  const count = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM tag_applications WHERE tagging_run_id = ?`)
      .get(runId) as { c: number }
  ).c;
  const result = db
    .prepare(
      `UPDATE tagging_runs SET completed_at_ms = ?, application_count = ? WHERE id = ? AND completed_at_ms IS NULL`
    )
    .run(completedAtMs, count, runId);
  if (result.changes === 0) return getTaggingRun(runId);
  return getTaggingRun(runId);
}

export function getTaggingRun(runId: string): TaggingRun | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM tagging_runs WHERE id = ?`)
    .get(runId) as Parameters<typeof rowToRun>[0] | undefined;
  return row ? rowToRun(row) : null;
}

export interface ListRunsOptions {
  scopeId?: string;
  scopeKind?: TaggingRunScopeKind;
  initiatorHandle?: string;
  includeInFlight?: boolean;
  limit?: number;
}

export function listTaggingRuns(opts: ListRunsOptions = {}): TaggingRun[] {
  const db = getIdentityDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.scopeId) {
    clauses.push('scope_id = ?');
    params.push(opts.scopeId);
  }
  if (opts.scopeKind) {
    clauses.push('scope_kind = ?');
    params.push(opts.scopeKind);
  }
  if (opts.initiatorHandle) {
    clauses.push('initiator_handle = ?');
    params.push(opts.initiatorHandle);
  }
  if (opts.includeInFlight === false) {
    clauses.push('completed_at_ms IS NOT NULL');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  const rows = db
    .prepare(
      `SELECT * FROM tagging_runs ${where} ORDER BY started_at_ms DESC, rowid DESC LIMIT ?`
    )
    .all(...params, limit) as Array<Parameters<typeof rowToRun>[0]>;
  return rows.map(rowToRun);
}

// ───────────────────────── application ops ─────────────────────────

export function applyTag(input: ApplyTagInput): TagApplication {
  const db = getIdentityDb();
  // Anchor must exist; the substrate refuses orphan applications because
  // verification readers MUST be able to resolve the anchor to compute
  // content_hash drift. Better fail-loud than write unreachable data.
  const anchor = getTaggingAnchor(input.targetAnchorId);
  if (!anchor) {
    throw new Error(`applyTag: anchor ${input.targetAnchorId} does not exist`);
  }
  const run = getTaggingRun(input.taggingRunId);
  if (!run) {
    throw new Error(`applyTag: tagging run ${input.taggingRunId} does not exist`);
  }
  if (run.completedAtMs !== null) {
    throw new Error(
      `applyTag: tagging run ${input.taggingRunId} is already completed; start a new run`
    );
  }
  const id = `tapp-${randomUUID()}`;
  const appliedAtMs = nowMs();
  db.prepare(
    `INSERT INTO tag_applications (
      id, tag_id, tag_version, target_anchor_id, target_claim_id,
      applicator_handle, applicator_kind, applied_reason,
      tagging_run_id, applied_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.tagId,
    input.tagVersion,
    input.targetAnchorId,
    input.targetClaimId ?? null,
    input.applicatorHandle,
    input.applicatorKind,
    input.appliedReason ?? null,
    input.taggingRunId,
    appliedAtMs
  );
  return {
    id,
    tagId: input.tagId,
    tagVersion: input.tagVersion,
    targetAnchorId: input.targetAnchorId,
    targetClaimId: input.targetClaimId ?? null,
    applicatorHandle: input.applicatorHandle,
    applicatorKind: input.applicatorKind,
    appliedReason: input.appliedReason ?? null,
    taggingRunId: input.taggingRunId,
    appliedAtMs
  };
}

export function getTagApplication(id: string): TagApplication | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM tag_applications WHERE id = ?`)
    .get(id) as Parameters<typeof rowToApplication>[0] | undefined;
  return row ? rowToApplication(row) : null;
}

export function listApplicationsForAnchor(anchorId: string): TagApplication[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tag_applications WHERE target_anchor_id = ? ORDER BY applied_at_ms ASC, rowid ASC`
    )
    .all(anchorId) as Array<Parameters<typeof rowToApplication>[0]>;
  return rows.map(rowToApplication);
}

export function listApplicationsForRun(runId: string): TagApplication[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tag_applications WHERE tagging_run_id = ? ORDER BY applied_at_ms ASC, rowid ASC`
    )
    .all(runId) as Array<Parameters<typeof rowToApplication>[0]>;
  return rows.map(rowToApplication);
}

export function listApplicationsForClaim(claimId: string): TagApplication[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tag_applications WHERE target_claim_id = ? ORDER BY applied_at_ms ASC, rowid ASC`
    )
    .all(claimId) as Array<Parameters<typeof rowToApplication>[0]>;
  return rows.map(rowToApplication);
}

// ───────────────────────── test helpers ─────────────────────────

export function resetTagApplicationsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM tag_applications').run();
  db.prepare('DELETE FROM tagging_runs').run();
  db.prepare('DELETE FROM tagging_anchors').run();
}
