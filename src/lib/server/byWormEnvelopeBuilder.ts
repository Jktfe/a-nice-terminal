// byWormEnvelopeBuilder — pure helpers that turn an audit_events row
// into a chained, signed AuditEnvelope. Separate from the dispatcher
// so the build logic is unit-testable without DB or sink.
//
// Spec: docs/concepts/ant-v02-byworm-sink-adapter.md
// Plan: antos-enterprise-control-plane-2026-05-27 §M1.3

import { randomUUID } from 'node:crypto';

import { sha256Hex } from './identityKeysStore';

import {
  type AuditEnvelope,
  type AuditEventCore,
  type RetentionClass,
  AUDIT_ENVELOPE_VERSION,
  canonicalEnvelopeForChainHash,
  canonicalEnvelopeForSigning,
} from './byWormSinkAdapter';

import { isAuditEntityKind } from './auditEntityKind';

// -- Source row shape ----------------------------------------------------
//
// Matches the audit_events table columns exactly (snake_case from
// SQLite). Mirrored from db.ts §audit_events. The dispatcher reads
// rows in this shape via an `AuditEventSource` (defined below).

export type AuditEventRow = {
  audit_id: string;
  at_ms: number;
  kind: string;
  entity_kind: string;
  entity_id: string;
  actor_agent_id: string | null;
  actor_runtime_id: string | null;
  before_json: string | null;
  after_json: string | null;
  request_id: string | null;
  ip_hash: string | null;
  challenge_proof: string | null;
};

// -- Source interface ----------------------------------------------------
//
// Indirection so the dispatcher can be tested without a DB. Production
// implementation reads from `audit_events` via SQL; test implementation
// returns in-memory rows.

export interface AuditEventSource {
  /**
   * Return up to `limit` rows with `at_ms > sinceMs`, ordered by
   * (at_ms ASC, audit_id ASC) for deterministic chain construction.
   */
  listSince(sinceMs: number, limit: number): AuditEventRow[];
}

// -- Builder inputs ------------------------------------------------------

export type BuildEnvelopeInput = {
  row: AuditEventRow;
  tenantId: string;
  /** envelope_id + canonical-form chain hash of the immediately prior envelope, or null for genesis. */
  prior: { envelopeId: string; envelopeHash: string } | null;
  /** FK identity_keys.key_id — the key that will sign this envelope. */
  signingKeyId: string;
  /** Signing function; pass `(payload) => signCanonicalPayload(payload, priv, pub)`. */
  signFn: (canonicalPayload: string) => string;
  /** Process identifier writing this envelope (e.g. 'ant-server'). */
  producedBy: string;
  /** Retention class for this envelope. Default: 'governance'. */
  retentionClass?: RetentionClass;
  /** Earliest ms epoch at which deletion is permitted. */
  retentionUntilMs: number;
  /** Deterministic clock for tests. Default: Date.now. */
  now?: () => number;
  /** Deterministic envelope_id generator for tests. Default: randomUUID. */
  envelopeIdFactory?: () => string;
};

// -- Builder -------------------------------------------------------------

/**
 * Build a chained, signed AuditEnvelope from an audit_events row.
 *
 * Steps:
 *   1. Coerce row into AuditEventCore (entity_kind is validated; unknown
 *      kinds throw — they should never escape db.ts's CHECK constraint
 *      but defending here means the envelope guard never sees an
 *      invalid entity_kind).
 *   2. Build envelope body with `signature: ''` placeholder.
 *   3. Compute canonical payload for signing (excludes signature).
 *   4. Call signFn to produce the signature.
 *   5. Return the fully-populated envelope.
 *
 * The chain-hash for the NEXT envelope is computed from this envelope's
 * canonical-with-signature form — see {@link envelopeChainHash}. The
 * caller threads `prior` through the dispatch loop.
 */
export function buildEnvelopeFromAuditEvent(input: BuildEnvelopeInput): AuditEnvelope {
  const {
    row,
    tenantId,
    prior,
    signingKeyId,
    signFn,
    producedBy,
    retentionClass = 'governance',
    retentionUntilMs,
    now = () => Date.now(),
    envelopeIdFactory = () => `env_${randomUUID()}`,
  } = input;

  if (!isAuditEntityKind(row.entity_kind)) {
    throw new Error(
      `buildEnvelopeFromAuditEvent: audit_events.entity_kind '${row.entity_kind}' is not in the v0.2 enum`,
    );
  }

  const event: AuditEventCore = {
    at_ms: row.at_ms,
    kind: row.kind,
    entity_kind: row.entity_kind,
    entity_id: row.entity_id,
    actor_agent_id: row.actor_agent_id,
    actor_runtime_id: row.actor_runtime_id,
    before_json: row.before_json,
    after_json: row.after_json,
    request_id: row.request_id,
    ip_hash: row.ip_hash,
    challenge_proof: row.challenge_proof,
  };

  // Build envelope body. Signature is computed AFTER the canonical
  // payload is formed, so the placeholder here is intentionally empty
  // — `canonicalEnvelopeForSigning` strips the signature field anyway.
  const draft: AuditEnvelope = {
    envelope_id: envelopeIdFactory(),
    envelope_version: AUDIT_ENVELOPE_VERSION,
    tenant_id: tenantId,
    audit_id: row.audit_id,
    event,
    prior_envelope_id: prior?.envelopeId ?? null,
    prior_envelope_hash: prior?.envelopeHash ?? null,
    signing_key_id: signingKeyId,
    signature: '',
    retention_class: retentionClass,
    retention_until_ms: retentionUntilMs,
    produced_at_ms: now(),
    produced_by: producedBy,
  };

  const canonical = canonicalEnvelopeForSigning(draft);
  const signature = signFn(canonical);

  return { ...draft, signature };
}

/**
 * Compute the chain hash of an envelope — to be stored on the NEXT
 * envelope as `prior_envelope_hash`. SHA-256 (hex) of the canonical
 * form that INCLUDES the signature (so re-signing breaks the chain).
 */
export function envelopeChainHash(envelope: AuditEnvelope): string {
  return sha256Hex(canonicalEnvelopeForChainHash(envelope));
}
