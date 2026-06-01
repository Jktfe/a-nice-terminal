// byWormAmendments — amendment envelope contract (M2.1).
//
// Envelopes are append-only — once written to a WORM sink, they MUST
// NOT be amended. To invalidate or correct an envelope, the dispatcher
// appends a NEW envelope that REFERENCES the original. These are
// "amendment envelopes". They have the same shape as any other
// AuditEnvelope; the only thing that distinguishes them is:
//
//   - event.kind  = 'amendment.<AmendmentKind>'
//   - event.entity_kind = 'system'
//   - event.entity_id = <envelope_id of the original envelope>
//   - event.after_json = JSON-serialised AmendmentReason
//   - event.actor_agent_id = the initiating agent (compliance officer etc.)
//
// This design keeps the contract surface unchanged — sinks see an
// amendment as just another envelope. Audit tools that care about
// amendments use the predicates and helpers below to walk the DAG
// (each original envelope can have zero or more amendments pointing
// to it; amendments can themselves be amended — e.g. a 'shredded'
// amendment that's later 'voided').
//
// M2.2 (separate slice) wires the crypto-shred semantics: encryption
// of the original envelope's event.before_json/after_json, with the
// key destroyed at shred time, leaving the original envelope on the
// WORM sink as ciphertext nobody can read.
//
// Spec: docs/concepts/ant-v02-byworm-sink-adapter.md
// Plan: antos-enterprise-control-plane-2026-05-27 §M2.1
// Depends on M1.1 contract (PR #125) + M1.3 dispatcher (PR #128)

import type { AuditEnvelope } from './byWormSinkAdapter';
import type { AuditEventRow } from './byWormEnvelopeBuilder';

// -- Amendment kinds -----------------------------------------------------
//
// Each kind has distinct semantics + audit/regulator-facing meaning.
// New kinds are additive (sinks tolerate unknown amendment kinds as
// just another envelope); validators that care should fail-closed on
// unknown kinds.

export type AmendmentKind =
  /**
   * The event payload's sensitive fields (before_json / after_json) were
   * encrypted at write time, and the encryption key has now been destroyed
   * (M2.2). The envelope remains on the WORM sink as ciphertext; the
   * before_json/after_json are unrecoverable. Used for GDPR Article 17
   * right-to-erasure compliance when the audit record cannot be deleted
   * (Object Lock) but its contents must become inaccessible.
   */
  | 'shredded'
  /**
   * The original event was determined to be factually incorrect (e.g.
   * wrong actor recorded, wrong entity_id). The corrected event is
   * captured in the amendment envelope's after_json; the original
   * stays on the chain for forensic completeness.
   */
  | 'corrected'
  /**
   * The original event is determined to have never legitimately
   * happened (mis-recording / spurious trigger / replay artifact).
   * Stronger than 'corrected' — auditors reading the chain should
   * treat the original as null for downstream analysis.
   */
  | 'voided'
  /**
   * The original event's retention class or compliance classification
   * was changed (e.g. operational → governance after a re-review).
   * Does NOT change retention on the original envelope's WORM record
   * (the WORM lock survives forever), but signals that a future copy
   * or replay should use the new classification.
   */
  | 'classified';

export const AMENDMENT_KINDS: ReadonlySet<AmendmentKind> = new Set<AmendmentKind>([
  'shredded',
  'corrected',
  'voided',
  'classified',
]);

export function isAmendmentKind(s: unknown): s is AmendmentKind {
  return typeof s === 'string' && AMENDMENT_KINDS.has(s as AmendmentKind);
}

// -- Amendment reason ----------------------------------------------------
//
// Captured as event.after_json on the amendment envelope. Survives the
// signing + chain hashing of the amendment envelope itself, so the
// reason is tamper-detectable just like any other envelope content.

export type AmendmentReason = {
  /**
   * Short machine-readable code (e.g. 'gdpr-art-17', 'data-quality-incident-42').
   * Stable enough that compliance dashboards can filter on it. Customer-defined
   * for the most part; ANT ships a small reserved set.
   */
  code: string;
  /** Human-readable explanation. */
  detail: string;
  /** The agent that initiated the amendment (e.g. compliance officer). */
  initiated_by_agent_id: string;
  /**
   * Optional approver (must be different from initiator for sensitive
   * amendment kinds — caller enforces, the type permits both shapes).
   */
  approved_by_agent_id?: string;
};

export function isAmendmentReason(o: unknown): o is AmendmentReason {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.code === 'string' &&
    typeof r.detail === 'string' &&
    typeof r.initiated_by_agent_id === 'string' &&
    (r.approved_by_agent_id === undefined || typeof r.approved_by_agent_id === 'string')
  );
}

// -- Builder -------------------------------------------------------------

export type AmendmentEventInput = {
  /** The envelope_id of the envelope being amended. */
  originalEnvelopeId: string;
  /** AmendmentKind — encodes the semantic shape of this amendment. */
  kind: AmendmentKind;
  /** AmendmentReason — captured verbatim in event.after_json. */
  reason: AmendmentReason;
  /** audit_id for the amendment audit_event row. */
  audit_id: string;
  /** at_ms timestamp for the amendment audit_event row. */
  at_ms: number;
};

/**
 * Build the audit_events-shaped row for an amendment. Caller then feeds
 * this through `buildEnvelopeFromAuditEvent` from byWormEnvelopeBuilder
 * to get a signed/chained envelope, and the dispatcher writes it to the
 * sink like any other envelope.
 *
 * The amendment is itself an audit event: a system-level record that
 * "the amendment happened". The amendment envelope's signing key + chain
 * linkage make the amendment tamper-detectable. The original envelope is
 * not modified.
 */
export function buildAmendmentEvent(input: AmendmentEventInput): AuditEventRow {
  return {
    audit_id: input.audit_id,
    at_ms: input.at_ms,
    kind: `amendment.${input.kind}`,
    entity_kind: 'system',
    entity_id: input.originalEnvelopeId,
    actor_agent_id: input.reason.initiated_by_agent_id,
    actor_runtime_id: null,
    before_json: null,
    after_json: JSON.stringify(input.reason),
    request_id: null,
    ip_hash: null,
    challenge_proof: null,
  };
}

// -- Predicates + extractors --------------------------------------------

const AMENDMENT_KIND_PREFIX = 'amendment.';

export function isAmendmentEnvelope(env: AuditEnvelope): boolean {
  return env.event.kind.startsWith(AMENDMENT_KIND_PREFIX) && env.event.entity_kind === 'system';
}

/**
 * Returns the envelope_id this envelope amends, or null if it is not
 * an amendment envelope.
 */
export function getAmendmentTargetEnvelopeId(env: AuditEnvelope): string | null {
  if (!isAmendmentEnvelope(env)) return null;
  return env.event.entity_id;
}

/**
 * Returns the AmendmentKind, or null if the envelope is not an
 * amendment OR if the suffix after `amendment.` is not a known kind.
 * Fail-closed: unknown kinds return null so downstream code can
 * decide how to handle a future kind it doesn't recognise.
 */
export function getAmendmentKind(env: AuditEnvelope): AmendmentKind | null {
  if (!isAmendmentEnvelope(env)) return null;
  const suffix = env.event.kind.slice(AMENDMENT_KIND_PREFIX.length);
  return isAmendmentKind(suffix) ? suffix : null;
}

/**
 * Parses event.after_json as an AmendmentReason. Returns null if the
 * envelope is not an amendment, after_json is missing, or the parsed
 * value doesn't pass the AmendmentReason guard.
 */
export function getAmendmentReason(env: AuditEnvelope): AmendmentReason | null {
  if (!isAmendmentEnvelope(env) || !env.event.after_json) return null;
  try {
    const parsed = JSON.parse(env.event.after_json);
    return isAmendmentReason(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
