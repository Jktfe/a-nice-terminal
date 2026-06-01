// byWormDispatcher — pulls audit_events rows since a watermark, builds
// chained signed envelopes, pushes them to a configured SinkAdapter, and
// returns a result describing what succeeded, what failed, and where to
// resume on the next tick.
//
// First-slice scope (M1.3):
//   - Single sink per dispatch call
//   - Caller threads the chain context (prior envelope) across batches
//   - On SinkError other than EnvelopeMalformed, halt the batch
//   - On EnvelopeMalformed, quarantine the row (caller is alerted) and
//     continue past it — the chain skips bad rows but stays intact
//   - No retry/backoff loop here (caller schedules retries)
//
// Out of scope (future slices):
//   - Multi-sink fanout in one pass
//   - Persistent watermark storage (sink_watermarks table)
//   - Retry-with-backoff inside dispatch (today: caller retries)
//   - Cron + on-demand HTTP surfaces
//
// Spec: docs/concepts/ant-v02-byworm-sink-adapter.md
// Plan: antos-enterprise-control-plane-2026-05-27 §M1.3

import {
  type AuditEnvelope,
  type SinkAdapter,
  type SinkReceipt,
  SinkError,
  type RetentionClass,
} from './byWormSinkAdapter';

import {
  type AuditEventRow,
  type AuditEventSource,
  buildEnvelopeFromAuditEvent,
  envelopeChainHash,
} from './byWormEnvelopeBuilder';

// -- Inputs --------------------------------------------------------------

export type DispatchInput = {
  source: AuditEventSource;
  sink: SinkAdapter;
  /** Tenant id assigned to every envelope built in this dispatch. M3-pending: replace with a per-row resolver. */
  tenantId: string;
  /** FK identity_keys.key_id — the system key signing envelopes in this pass. */
  signingKeyId: string;
  /** Signing function; bind your `signCanonicalPayload(_, priv, pub)` here. */
  signFn: (canonicalPayload: string) => string;
  /** Process identifier (e.g. 'ant-server'). */
  producedBy: string;
  /**
   * Watermark — the dispatcher fetches rows where `at_ms > sinceMs`.
   * Caller persists this between runs.
   */
  sinceMs: number;
  /** Maximum rows to fetch in one dispatch. Default: 100. */
  batchLimit?: number;
  /** Default retention class for envelopes when no per-row resolver is given. Default: 'governance'. */
  defaultRetentionClass?: RetentionClass;
  /** Resolver: row → retention class. Overrides defaultRetentionClass per row. */
  retentionClassFor?: (row: AuditEventRow) => RetentionClass;
  /** Resolver: row → retention_until_ms. Default: now + 7 years. */
  retentionUntilMsFor?: (row: AuditEventRow) => number;
  /**
   * Chain context carried from the previous dispatch run. null = first
   * envelope this tenant ever produced (genesis).
   */
  prior: { envelopeId: string; envelopeHash: string } | null;
  /** Deterministic clock for tests. */
  now?: () => number;
  /** Deterministic envelope_id factory for tests. */
  envelopeIdFactory?: () => string;
};

// -- Result --------------------------------------------------------------

export type DispatchSuccess = {
  row: AuditEventRow;
  envelope: AuditEnvelope;
  receipt: SinkReceipt;
};

export type DispatchResult = {
  /**
   * New watermark — `at_ms` of the last row successfully written.
   * If no rows were written, equals the input `sinceMs` (caller should
   * persist watermarks regardless — a no-op tick still represents
   * "I checked up to here").
   */
  watermark: number;
  /** Successfully written envelopes + their receipts, in order. */
  succeeded: DispatchSuccess[];
  /**
   * Rows quarantined as malformed (caught by isAuditEnvelope guard via
   * the adapter, or by entity_kind validation in the builder). Caller
   * alerts on these; they do NOT halt the batch.
   */
  quarantined: { row: AuditEventRow; reason: string }[];
  /** If a non-malformed SinkError stopped the batch, the row that triggered it + the error. */
  haltedAt?: { row: AuditEventRow; error: SinkError };
  /**
   * Chain context for the next dispatch call. Updated on every
   * successful write; unchanged when batch halts before any success.
   */
  nextPrior: { envelopeId: string; envelopeHash: string } | null;
};

// -- Defaults ------------------------------------------------------------

const DEFAULT_BATCH_LIMIT = 100;
const SEVEN_YEARS_MS = 7 * 365 * 24 * 3600 * 1000;

function defaultRetentionUntilMsFor(now: () => number) {
  return () => now() + SEVEN_YEARS_MS;
}

// -- Dispatch ------------------------------------------------------------

/**
 * Run one dispatch pass: fetch rows since watermark, build + write
 * envelopes, return result. Caller drives the loop (cron tick, HTTP
 * endpoint, CLI verb) and persists the returned watermark + nextPrior.
 */
export async function dispatchAuditEvents(input: DispatchInput): Promise<DispatchResult> {
  const {
    source,
    sink,
    tenantId,
    signingKeyId,
    signFn,
    producedBy,
    sinceMs,
    batchLimit = DEFAULT_BATCH_LIMIT,
    defaultRetentionClass = 'governance',
    retentionClassFor,
    retentionUntilMsFor,
    prior,
    now = () => Date.now(),
    envelopeIdFactory,
  } = input;

  const retentionUntilResolver = retentionUntilMsFor ?? defaultRetentionUntilMsFor(now);

  const rows = source.listSince(sinceMs, batchLimit);

  const succeeded: DispatchSuccess[] = [];
  const quarantined: { row: AuditEventRow; reason: string }[] = [];
  let chainPrior = prior;
  let watermark = sinceMs;
  let haltedAt: { row: AuditEventRow; error: SinkError } | undefined;

  for (const row of rows) {
    let envelope: AuditEnvelope;
    try {
      envelope = buildEnvelopeFromAuditEvent({
        row,
        tenantId,
        prior: chainPrior,
        signingKeyId,
        signFn,
        producedBy,
        retentionClass: retentionClassFor?.(row) ?? defaultRetentionClass,
        retentionUntilMs: retentionUntilResolver(row),
        now,
        envelopeIdFactory,
      });
    } catch (err) {
      // Builder threw — usually unknown entity_kind. Quarantine + continue.
      quarantined.push({
        row,
        reason: (err as { message?: string }).message ?? 'envelope build failed',
      });
      continue;
    }

    let receipt: SinkReceipt;
    try {
      receipt = await sink.write(envelope);
    } catch (err) {
      const sinkErr =
        err instanceof SinkError
          ? err
          : new SinkError('SinkUnavailable', sink.kind, 'non-SinkError thrown by adapter', err);

      if (sinkErr.kind === 'EnvelopeMalformed') {
        // The adapter rejected the envelope shape (post-builder). The
        // chain skips this row but keeps moving — `chainPrior` and
        // `watermark` do NOT advance (we never wrote anything), so the
        // next attempt against this row will get the SAME prior. But
        // since we've quarantined, we move past it in this batch.
        quarantined.push({
          row,
          reason: `sink rejected as malformed: ${sinkErr.message}`,
        });
        continue;
      }

      // Any other SinkError halts the batch. Caller retries.
      haltedAt = { row, error: sinkErr };
      break;
    }

    succeeded.push({ row, envelope, receipt });
    watermark = row.at_ms;
    chainPrior = {
      envelopeId: envelope.envelope_id,
      envelopeHash: envelopeChainHash(envelope),
    };
  }

  return {
    watermark,
    succeeded,
    quarantined,
    haltedAt,
    nextPrior: chainPrior,
  };
}
