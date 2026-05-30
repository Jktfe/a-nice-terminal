// byWormSinkAdapter — BYOWORM (Bring Your Own WORM) Sink Adapter contract.
// Defines the envelope shape + adapter interface so any enterprise customer
// can plug their own WORM-grade audit destination (S3 Object Lock, Splunk,
// Datadog, Elastic, NetApp SnapLock, immutable Postgres, on-prem object
// store, etc.) without ANT shipping a bespoke integration for each one.
//
// Spec: docs/concepts/ant-v02-byworm-sink-adapter.md
// Plan: antos-enterprise-control-plane-2026-05-27 M1.1
// Source table: audit_events (v0.2, see db.ts §audit_events).

import type { AuditEntityKind } from './auditEntityKind';

// -- Audit Envelope -------------------------------------------------------
//
// One envelope per audit_events row, augmented with tenant scope, chain
// linkage (for tamper detection), and producer-side signature. Envelopes
// are append-only; once written to a sink they MUST NOT be amended. To
// invalidate an envelope, append a tombstone envelope (M2 crypto-shred).

export const AUDIT_ENVELOPE_VERSION = '1.0' as const;
export type AuditEnvelopeVersion = typeof AUDIT_ENVELOPE_VERSION;

export type RetentionClass = 'compliance' | 'governance' | 'operational';

export const RETENTION_CLASSES: ReadonlySet<RetentionClass> = new Set<RetentionClass>([
  'compliance',
  'governance',
  'operational',
]);

export type AuditEventCore = {
  /** Source audit_events.at_ms (when the underlying event happened). */
  at_ms: number;
  /** audit_events.kind (e.g. 'agent.created', 'membership.joined'). */
  kind: string;
  /** audit_events.entity_kind enum. */
  entity_kind: AuditEntityKind;
  /** audit_events.entity_id (PK of the affected row). */
  entity_id: string;
  /** audit_events.actor_agent_id (may be null for system events). */
  actor_agent_id: string | null;
  /** audit_events.actor_runtime_id (may be null). */
  actor_runtime_id: string | null;
  /** audit_events.before_json (state pre-change, may be null). */
  before_json: string | null;
  /** audit_events.after_json (state post-change, may be null). */
  after_json: string | null;
  /** audit_events.request_id (correlation across multi-row mutations). */
  request_id: string | null;
  /** audit_events.ip_hash (privacy-preserving IP fingerprint). */
  ip_hash: string | null;
  /** audit_events.challenge_proof (any cryptographic proof captured). */
  challenge_proof: string | null;
};

export type AuditEnvelope = {
  // -- Envelope identity ------------------------------------------------
  envelope_id: string;
  envelope_version: AuditEnvelopeVersion;

  // -- Tenant scope (M3 dependency) ------------------------------------
  tenant_id: string;

  // -- Source audit_event reference (for replay + dedup) ---------------
  audit_id: string;

  // -- Event content (verbatim from audit_events row) ------------------
  event: AuditEventCore;

  // -- Audit chain (tamper detection) ----------------------------------
  /** Envelope id of the prior envelope for this tenant, or null for the genesis envelope. */
  prior_envelope_id: string | null;
  /** SHA-256 (hex) of the canonical-form prior envelope, or null for genesis. */
  prior_envelope_hash: string | null;

  // -- Non-repudiation signature ---------------------------------------
  /** FK identity_keys.key_id; key that signed this envelope. */
  signing_key_id: string;
  /** Detached signature over canonicalEnvelopeForSigning(envelope). Base64. */
  signature: string;

  // -- Retention policy at write time ----------------------------------
  retention_class: RetentionClass;
  /** Earliest ms epoch at which the sink is permitted to delete this envelope. */
  retention_until_ms: number;

  // -- Producer metadata -----------------------------------------------
  /** When envelope was constructed (NOT when audit_event happened — see event.at_ms for that). */
  produced_at_ms: number;
  /** Identifier of the process that produced the envelope. */
  produced_by: string;
};

// -- Sink Receipt ---------------------------------------------------------
//
// Returned by a sink adapter on durable write. Carries the sink's own
// attestation id (so the customer can replay queries against the sink),
// the sink kind, and the retention policy the sink actually committed to.
// Retention values in the receipt MAY differ from the envelope's
// requested values if the sink enforces a stricter policy (e.g. S3
// Object Lock compliance mode rounds up to bucket-level retention).

export type SinkReceipt = {
  envelope_id: string;
  sink_kind: string;
  sink_attestation_id: string;
  /** When sink confirms durable write. */
  written_at_ms: number;
  /** Retention class the sink actually committed to. */
  retention_class: RetentionClass;
  /** Retention floor the sink actually committed to (may be ≥ envelope.retention_until_ms). */
  retention_until_ms: number;
};

export type SinkHealth = {
  healthy: boolean;
  detail?: string;
};

// -- Sink Adapter Interface ----------------------------------------------
//
// Customers implement this interface to plug their WORM destination.
// ANT ships:
//   - byWormNoOpAdapter (this slice)        — reference + tests + dev
//   - byWormS3ObjectLockAdapter (M1.2)      — AWS S3 compliance mode
//   - byWormSiemAdapter (M7.2, @2ec)        — Splunk/Datadog/Elastic destinations

export interface SinkAdapter {
  /** Stable identifier — used in receipts and the registry. */
  readonly kind: string;

  /**
   * Cheap health probe. MUST NOT block on a real write. Called by the
   * audit dispatcher before flushing a batch so we can degrade gracefully
   * if the sink is down.
   */
  health(): Promise<SinkHealth>;

  /**
   * Write one envelope. Returns receipt on durable write. Throws
   * SinkError on failure. The dispatcher is responsible for retry +
   * backoff policy; the adapter SHOULD throw a SinkError with the
   * appropriate kind so the dispatcher can choose to retry vs hold.
   */
  write(envelope: AuditEnvelope): Promise<SinkReceipt>;

  /**
   * Optional batch write. Default implementation in dispatcher = serial
   * loop over write(). Adapters MAY implement this for transport-level
   * batching (e.g. S3 bulk PUT, Splunk HEC bulk submit). Order MUST be
   * preserved in the returned receipts.
   */
  writeBatch?(envelopes: AuditEnvelope[]): Promise<SinkReceipt[]>;
}

// -- Errors ---------------------------------------------------------------

export type SinkErrorKind =
  | 'SinkUnavailable'    // transport down, network failure → retry later
  | 'SinkRejected'       // sink refused the envelope (auth, quota) → escalate
  | 'SinkRetryable'      // transient (rate limit, brief lock) → retry now
  | 'EnvelopeMalformed'; // envelope failed sink-side validation → do NOT retry

export class SinkError extends Error {
  readonly kind: SinkErrorKind;
  readonly sinkKind: string;
  readonly detail?: unknown;

  constructor(kind: SinkErrorKind, sinkKind: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'SinkError';
    this.kind = kind;
    this.sinkKind = sinkKind;
    this.detail = detail;
  }
}

// -- Type guards ----------------------------------------------------------

export function isRetentionClass(s: unknown): s is RetentionClass {
  return typeof s === 'string' && RETENTION_CLASSES.has(s as RetentionClass);
}

export function isAuditEventCore(o: unknown): o is AuditEventCore {
  if (!o || typeof o !== 'object') return false;
  const e = o as Record<string, unknown>;
  return (
    typeof e.at_ms === 'number' &&
    typeof e.kind === 'string' &&
    typeof e.entity_kind === 'string' &&
    typeof e.entity_id === 'string' &&
    (e.actor_agent_id === null || typeof e.actor_agent_id === 'string') &&
    (e.actor_runtime_id === null || typeof e.actor_runtime_id === 'string') &&
    (e.before_json === null || typeof e.before_json === 'string') &&
    (e.after_json === null || typeof e.after_json === 'string') &&
    (e.request_id === null || typeof e.request_id === 'string') &&
    (e.ip_hash === null || typeof e.ip_hash === 'string') &&
    (e.challenge_proof === null || typeof e.challenge_proof === 'string')
  );
}

export function isAuditEnvelope(o: unknown): o is AuditEnvelope {
  if (!o || typeof o !== 'object') return false;
  const e = o as Record<string, unknown>;
  return (
    typeof e.envelope_id === 'string' &&
    e.envelope_version === AUDIT_ENVELOPE_VERSION &&
    typeof e.tenant_id === 'string' &&
    typeof e.audit_id === 'string' &&
    isAuditEventCore(e.event) &&
    (e.prior_envelope_id === null || typeof e.prior_envelope_id === 'string') &&
    (e.prior_envelope_hash === null || typeof e.prior_envelope_hash === 'string') &&
    typeof e.signing_key_id === 'string' &&
    typeof e.signature === 'string' &&
    isRetentionClass(e.retention_class) &&
    typeof e.retention_until_ms === 'number' &&
    typeof e.produced_at_ms === 'number' &&
    typeof e.produced_by === 'string'
  );
}

export function isSinkReceipt(o: unknown): o is SinkReceipt {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.envelope_id === 'string' &&
    typeof r.sink_kind === 'string' &&
    typeof r.sink_attestation_id === 'string' &&
    typeof r.written_at_ms === 'number' &&
    isRetentionClass(r.retention_class) &&
    typeof r.retention_until_ms === 'number'
  );
}

// -- Canonical form for signing + chain hash -----------------------------
//
// The envelope MUST be serialised deterministically before signing or
// hashing. Stable key order; signature field excluded from input to
// itself; prior_envelope_hash included verbatim (it's the chain link to
// the previous envelope).

export function canonicalEnvelopeForSigning(envelope: AuditEnvelope): string {
  const { signature: _omit, ...rest } = envelope;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function canonicalEnvelopeForChainHash(envelope: AuditEnvelope): string {
  // For chain-hash, include the signature so a downstream verifier can
  // detect "envelope body was re-signed by a different key after the
  // fact" as a tamper signal.
  return JSON.stringify(envelope, Object.keys(envelope).sort());
}
