// byWormNoOpAdapter — reference SinkAdapter that accepts every envelope
// and returns a synthetic receipt. Two purposes:
//   1. Dev/test default when no real WORM sink is configured.
//   2. Test double for the audit dispatcher (collects envelopes in memory
//      so callers can assert ordering + content).
//
// MUST NOT be used in production with real audit data. The adapter does
// not persist envelopes anywhere durable; if the process restarts, the
// in-memory record is lost. Enterprise deployments use byWormS3ObjectLockAdapter
// (M1.2) or a customer-supplied SinkAdapter.
//
// Spec: docs/concepts/ant-v02-byworm-sink-adapter.md §Reference adapter.

import {
  type AuditEnvelope,
  type SinkAdapter,
  type SinkHealth,
  type SinkReceipt,
  SinkError,
  isAuditEnvelope,
} from './byWormSinkAdapter';

export type NoOpAdapterOptions = {
  /** When true, retain every envelope in-memory for inspection. Default: false. */
  collect?: boolean;
  /**
   * When set, write() will throw a SinkError of this kind on every call.
   * Used by tests to exercise the dispatcher's error handling without
   * standing up a real failing sink.
   */
  failWith?: SinkError['kind'];
  /** Custom clock for deterministic tests. */
  now?: () => number;
};

export class ByWormNoOpAdapter implements SinkAdapter {
  readonly kind = 'no-op';
  private readonly collect: boolean;
  private readonly failWith?: SinkError['kind'];
  private readonly now: () => number;
  private readonly collected: AuditEnvelope[] = [];
  private receiptCounter = 0;

  constructor(opts: NoOpAdapterOptions = {}) {
    this.collect = opts.collect ?? false;
    this.failWith = opts.failWith;
    this.now = opts.now ?? (() => Date.now());
  }

  async health(): Promise<SinkHealth> {
    if (this.failWith === 'SinkUnavailable') {
      return { healthy: false, detail: 'no-op adapter configured to fail with SinkUnavailable' };
    }
    return { healthy: true };
  }

  async write(envelope: AuditEnvelope): Promise<SinkReceipt> {
    if (!isAuditEnvelope(envelope)) {
      throw new SinkError(
        'EnvelopeMalformed',
        this.kind,
        'envelope failed isAuditEnvelope guard',
        envelope,
      );
    }

    if (this.failWith) {
      throw new SinkError(
        this.failWith,
        this.kind,
        `no-op adapter configured to fail with ${this.failWith}`,
      );
    }

    if (this.collect) {
      this.collected.push(envelope);
    }

    this.receiptCounter += 1;
    return {
      envelope_id: envelope.envelope_id,
      sink_kind: this.kind,
      sink_attestation_id: `no-op-attestation-${this.receiptCounter}`,
      written_at_ms: this.now(),
      retention_class: envelope.retention_class,
      retention_until_ms: envelope.retention_until_ms,
    };
  }

  /** Returns a defensive copy of collected envelopes. Empty if collect=false. */
  getCollected(): AuditEnvelope[] {
    return [...this.collected];
  }

  /** Clear the in-memory collection. */
  clearCollected(): void {
    this.collected.length = 0;
  }
}
