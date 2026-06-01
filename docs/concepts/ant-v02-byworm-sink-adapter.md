---
title: ANT v0.2 — BYOWORM Sink Adapter (M1.1 contract + M1.2 S3 Object Lock impl)
date: 2026-05-30
authors: ["@enterprisec"]
status: draft — M1.1 contract + M1.2 S3 Object Lock impl landed; M1.3 dispatcher pending
plan: antos-enterprise-control-plane-2026-05-27 §M1
companion: ant-v02-identity-and-recovery.md (audit_events table source)
---

# BYOWORM — Bring Your Own WORM

## Why this exists

ANT's enterprise customers — regulated banks, asset managers, hedge funds, FCA/SEC/MiFID/DORA-supervised firms — already have a WORM-grade audit destination. Some use AWS S3 with Object Lock (compliance mode). Some use Splunk or Datadog with retention policies. Some run on-prem NetApp SnapLock or Dell ECM. Some have a custom immutable Postgres + replication setup.

ANT cannot ship a bespoke integration per customer. Instead we ship a **contract** plus a **reference S3 Object Lock implementation** (M1.2). Customers (or partners) implement the contract against their destination of choice. This is the Bring Your Own WORM pattern.

## What this slice (M1.1) ships

| Artefact | Path | Purpose |
|---|---|---|
| Envelope + adapter types | `src/lib/server/byWormSinkAdapter.ts` | TypeScript contract + type guards + canonical-form helpers |
| Audit entity-kind enum | `src/lib/server/auditEntityKind.ts` | Mirror of `audit_events.entity_kind` CHECK enum |
| Reference adapter | `src/lib/server/byWormNoOpAdapter.ts` | Accepts every envelope, returns synthetic receipt; dev/test only |
| Tests | `*.test.ts` co-located | 30 tests; contract guards + no-op behaviour + canonical form determinism |
| Spec | this file | Architecture + invariants + future-slice anchors |

**Out of scope** for this slice:
- The actual S3 Object Lock implementation (M1.2)
- The audit dispatcher that reads from `audit_events` and pushes envelopes to a sink (M1.3, pending sequencing)
- SIEM adapters for Splunk/Datadog/Elastic (M7.2, @2ec — implementations of this contract)
- Crypto-shred amendment envelopes (M2)
- Tenant-scoped routing (M3)

## Envelope shape

```
AuditEnvelope {
  envelope_id        ULID — unique per envelope
  envelope_version   '1.0' — semver for contract evolution
  tenant_id          string — scope (post-M3 = org_id)
  audit_id           FK audit_events.audit_id (for replay + dedup)
  event              { at_ms, kind, entity_kind, entity_id, actor_*, before/after_json, ... }
  prior_envelope_id  string | null — null for genesis envelope per tenant
  prior_envelope_hash string | null — SHA-256 of canonical-form prior envelope
  signing_key_id     FK identity_keys.key_id
  signature          base64, detached, over canonicalEnvelopeForSigning()
  retention_class    'compliance' | 'governance' | 'operational'
  retention_until_ms epoch ms — earliest permitted deletion
  produced_at_ms     epoch ms — when envelope was constructed
  produced_by        identifier of the producing process
}
```

The envelope is a **superset** of an `audit_events` row. The `event` field is a 1:1 copy of the source row; the surrounding fields are envelope-layer concerns (tenant scope, chain linkage, signing, retention).

## Three structural invariants

1. **Envelopes are append-only.** Once written to a sink, the envelope MUST NOT be amended. To invalidate, append a tombstone envelope (M2 crypto-shred amendment).

2. **Chain integrity via `prior_envelope_hash`.** Each envelope embeds the SHA-256 of the prior envelope's canonical form. Tampering with any envelope downstream invalidates every subsequent chain link — detectable by a downstream auditor without trusting the sink. The first envelope per tenant has `prior_envelope_id = null, prior_envelope_hash = null` (genesis).

3. **Signature excludes itself; chain hash includes it.**
   - `canonicalEnvelopeForSigning()` omits the `signature` field — the producer signs everything except the signature itself.
   - `canonicalEnvelopeForChainHash()` includes the `signature` — so a tamper-by-re-signing attempt (different key, same body) shows up as a chain break.

## Receipt shape

```
SinkReceipt {
  envelope_id           string — round-trip back to the envelope
  sink_kind             'no-op' | 's3-object-lock' | 'splunk' | ...
  sink_attestation_id   sink-supplied receipt (S3 ARN, Splunk ack id, ...)
  written_at_ms         when sink confirms durable write
  retention_class       what the sink actually committed to
  retention_until_ms    sink-side retention floor (MAY be ≥ envelope.retention_until_ms)
}
```

The receipt's retention values MAY differ from the envelope's request when the sink enforces a stricter policy. Example: S3 Object Lock in compliance mode rounds retention up to the bucket-level default retention if shorter.

## Adapter interface

```ts
interface SinkAdapter {
  readonly kind: string;
  health(): Promise<SinkHealth>;
  write(envelope: AuditEnvelope): Promise<SinkReceipt>;
  writeBatch?(envelopes: AuditEnvelope[]): Promise<SinkReceipt[]>;
}
```

Adapters MUST throw `SinkError` (with `kind` ∈ `SinkUnavailable | SinkRejected | SinkRetryable | EnvelopeMalformed`) on failure. The dispatcher chooses retry policy based on the error kind:

| Kind | Dispatcher response |
|---|---|
| `SinkUnavailable` | Retry with exponential backoff; preserve order |
| `SinkRetryable` | Retry immediately (transient: rate limit, brief lock) |
| `SinkRejected` | Escalate — the sink refused (auth, quota); do NOT retry blindly |
| `EnvelopeMalformed` | Do NOT retry — the envelope is broken; quarantine and alert |

## Delivery semantics (forward-looking, M1.3)

The audit dispatcher (M1.3) uses **at-least-once delivery** with watermark-based replay:
- Reads `audit_events` rows since the per-tenant watermark
- Constructs envelopes, signs, chain-links
- Writes via `SinkAdapter.write()` (or `writeBatch` if implemented)
- On `SinkReceipt`, advances the watermark
- On `SinkError`, retries per kind

Duplicate envelopes (replay edge case) are handled by sinks idempotently keyed on `envelope_id`. The reference S3 implementation uses `envelope_id` as the object key suffix; re-writes are PUT-with-same-key, which is idempotent.

## Reference adapter (no-op)

`ByWormNoOpAdapter` is the reference implementation:
- Accepts every well-formed envelope
- Returns a synthetic receipt mirroring the envelope's retention request
- Optionally collects envelopes in-memory (`collect: true`) for tests
- Can be configured to fail with a chosen `SinkError` kind (`failWith: 'SinkRetryable'` etc.) so the dispatcher's retry logic can be exercised without a real failing sink

**Do not ship this to production.** It writes nothing durable. The capability ledger row marks this explicitly.

## Customer adapter checklist

For a customer (or partner) implementing this contract for their destination:

1. **Identify a stable kind.** Used in receipts and the registry. E.g. `'s3-object-lock'`, `'splunk-hec'`, `'datadog-audit-log'`.
2. **Implement `health()` as cheap.** No real write — just check connectivity / auth / quota. Called frequently by the dispatcher.
3. **Implement `write()` idempotently.** Same `envelope_id` written twice MUST result in one durable record. The dispatcher's at-least-once semantics rely on this.
4. **Surface retention truthfully.** If the sink enforces a stricter retention than the envelope requests, return the sink's actual values in the receipt — auditors will reconcile against the receipt, not the envelope.
5. **Use `SinkError` precisely.** Pick the error kind that lets the dispatcher take the right action. Misclassifying transient as permanent or vice versa is the most common adapter bug.
6. **Preserve order in `writeBatch`.** Receipts MUST be returned in the same order as input envelopes — the dispatcher uses index alignment.

## Build sequence (M1)

| Slice | Status | Owner | Notes |
|---|---|---|---|
| M1.1 contract + reference adapter | landed (PR #125 fb731d6) | @enterprisec | Type-level + no-op + tests + this doc |
| M1.2 S3 Object Lock backend | this PR (stacked on PR #125) | @enterprisec | AWS SDK v3, compliance mode mapping, date-partitioned keys, AWS error → SinkError mapping |
| M1.3 audit dispatcher | planned | TBD | Watermark + replay + retry-per-error-kind |
| M7.2 SIEM destination adapters | planned (depends on M1.1) | @2ec | Splunk HEC / Datadog Logs / Elastic — implementations of this contract |

## Acceptance criteria

This slice closes the type-level contract acceptance for M1.1. The substrate acceptance — "every share/recall/cross-wall event lands in bank's WORM sink within reconciliation window" — remains gated on M1.2 + M1.3.

## Open questions banked

1. **Genesis envelope discovery.** When does a tenant's first envelope go out? Today: first audit_event after tenant onboarding. Alternative: synthetic `system.tenant.onboarded` envelope at tenant creation, deterministic genesis. Worth deciding at M1.3 dispatcher land.
2. **Cross-sink fanout.** Some customers will want both a primary (S3 Object Lock) and a hot-search (Splunk) destination. Should the dispatcher fan out to multiple adapters in parallel? Likely yes. Lands as a dispatcher concern, not an adapter concern — the contract above already supports multi-adapter use.
3. **Envelope schema evolution.** `envelope_version: '1.0'` reserves the field. Future minor versions should be additive (sinks tolerate new fields); major version bumps would break chain integrity. Avoid major bumps if possible.
