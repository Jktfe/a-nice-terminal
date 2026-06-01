import { describe, expect, it } from 'vitest';

import { ByWormNoOpAdapter } from './byWormNoOpAdapter';
import { dispatchAuditEvents } from './byWormDispatcher';
import type { AuditEventRow, AuditEventSource } from './byWormEnvelopeBuilder';
import { SinkError } from './byWormSinkAdapter';

// -- Test source ---------------------------------------------------------

class InMemorySource implements AuditEventSource {
  constructor(private readonly rows: AuditEventRow[]) {}

  listSince(sinceMs: number, limit: number): AuditEventRow[] {
    return this.rows
      .filter((r) => r.at_ms > sinceMs)
      .sort((a, b) => a.at_ms - b.at_ms || a.audit_id.localeCompare(b.audit_id))
      .slice(0, limit);
  }
}

function makeRow(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    audit_id: 'aud_001',
    at_ms: 1_780_000_000_000,
    kind: 'agent.created',
    entity_kind: 'agent',
    entity_id: 'agt_001',
    actor_agent_id: null,
    actor_runtime_id: null,
    before_json: null,
    after_json: null,
    request_id: null,
    ip_hash: null,
    challenge_proof: null,
    ...overrides,
  };
}

// Deterministic signing function for tests
let envelopeCounter = 0;
function nextEnvelopeId(): string {
  envelopeCounter += 1;
  return `env_${String(envelopeCounter).padStart(4, '0')}`;
}

function freshDispatchInputs() {
  envelopeCounter = 0;
  return {
    tenantId: 'org_nmvc',
    signingKeyId: 'key_device_01',
    signFn: (canonical: string) => `sig:${canonical.length}`,
    producedBy: 'ant-server',
    now: () => 1_780_000_999_000,
    envelopeIdFactory: nextEnvelopeId,
  };
}

// -- Happy path ----------------------------------------------------------

describe('dispatchAuditEvents — happy path', () => {
  it('writes rows in at_ms order to the sink and advances the watermark', async () => {
    const rows = [
      makeRow({ audit_id: 'a', at_ms: 1000 }),
      makeRow({ audit_id: 'b', at_ms: 2000 }),
      makeRow({ audit_id: 'c', at_ms: 3000 }),
    ];
    const source = new InMemorySource(rows);
    const sink = new ByWormNoOpAdapter({ collect: true });

    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source,
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    expect(result.succeeded).toHaveLength(3);
    expect(result.quarantined).toHaveLength(0);
    expect(result.haltedAt).toBeUndefined();
    expect(result.watermark).toBe(3000);

    const collected = sink.getCollected();
    expect(collected.map((e) => e.audit_id)).toEqual(['a', 'b', 'c']);
  });

  it('chains envelopes — prior_envelope_id/hash flow forward across the batch', async () => {
    const rows = [
      makeRow({ audit_id: 'a', at_ms: 1000 }),
      makeRow({ audit_id: 'b', at_ms: 2000 }),
      makeRow({ audit_id: 'c', at_ms: 3000 }),
    ];
    const source = new InMemorySource(rows);
    const sink = new ByWormNoOpAdapter({ collect: true });

    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source,
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    const [e1, e2, e3] = sink.getCollected();

    // Genesis envelope has null prior
    expect(e1.prior_envelope_id).toBeNull();
    expect(e1.prior_envelope_hash).toBeNull();

    // Second envelope points at first
    expect(e2.prior_envelope_id).toBe(e1.envelope_id);
    expect(e2.prior_envelope_hash).toMatch(/^[0-9a-f]{64}$/);

    // Third envelope points at second
    expect(e3.prior_envelope_id).toBe(e2.envelope_id);
    expect(e3.prior_envelope_hash).toMatch(/^[0-9a-f]{64}$/);

    // nextPrior reflects the last successful envelope
    expect(result.nextPrior).toEqual({
      envelopeId: e3.envelope_id,
      envelopeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('continues the chain across batches when caller threads prior through', async () => {
    const rows1 = [makeRow({ audit_id: 'a', at_ms: 1000 })];
    const rows2 = [makeRow({ audit_id: 'b', at_ms: 2000 })];
    const source1 = new InMemorySource(rows1);
    const source2 = new InMemorySource(rows2);
    const sink = new ByWormNoOpAdapter({ collect: true });

    const inputs = freshDispatchInputs();

    const r1 = await dispatchAuditEvents({
      ...inputs,
      source: source1,
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    const r2 = await dispatchAuditEvents({
      ...inputs,
      envelopeIdFactory: nextEnvelopeId, // keep counter ticking
      source: source2,
      sink,
      sinceMs: r1.watermark,
      prior: r1.nextPrior,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    const [first, second] = sink.getCollected();
    expect(second.prior_envelope_id).toBe(first.envelope_id);
    expect(second.prior_envelope_hash).toBe(r1.nextPrior?.envelopeHash);
    expect(r2.watermark).toBe(2000);
  });

  it('returns the input watermark unchanged when no rows match', async () => {
    const source = new InMemorySource([makeRow({ at_ms: 500 })]);
    const sink = new ByWormNoOpAdapter();
    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source,
      sink,
      sinceMs: 1000,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });
    expect(result.succeeded).toHaveLength(0);
    expect(result.watermark).toBe(1000);
    expect(result.nextPrior).toBeNull();
  });

  it('respects batchLimit', async () => {
    const rows = [
      makeRow({ audit_id: 'a', at_ms: 1000 }),
      makeRow({ audit_id: 'b', at_ms: 2000 }),
      makeRow({ audit_id: 'c', at_ms: 3000 }),
      makeRow({ audit_id: 'd', at_ms: 4000 }),
    ];
    const source = new InMemorySource(rows);
    const sink = new ByWormNoOpAdapter();
    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source,
      sink,
      sinceMs: 0,
      prior: null,
      batchLimit: 2,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });
    expect(result.succeeded).toHaveLength(2);
    expect(result.watermark).toBe(2000);
  });
});

// -- Retention class resolution -----------------------------------------

describe('dispatchAuditEvents — retention class', () => {
  it('uses defaultRetentionClass when no resolver given', async () => {
    const sink = new ByWormNoOpAdapter({ collect: true });
    await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([makeRow()]),
      sink,
      sinceMs: 0,
      prior: null,
      defaultRetentionClass: 'compliance',
      retentionUntilMsFor: () => 999,
    });
    expect(sink.getCollected()[0].retention_class).toBe('compliance');
  });

  it('uses per-row resolver when provided', async () => {
    const sink = new ByWormNoOpAdapter({ collect: true });
    await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([
        makeRow({ audit_id: 'a', at_ms: 1000, kind: 'agent.created' }),
        makeRow({ audit_id: 'b', at_ms: 2000, kind: 'system.boot' }),
      ]),
      sink,
      sinceMs: 0,
      prior: null,
      retentionClassFor: (row) =>
        row.kind.startsWith('system.') ? 'operational' : 'compliance',
      retentionUntilMsFor: () => 999,
    });
    const collected = sink.getCollected();
    expect(collected[0].retention_class).toBe('compliance');
    expect(collected[1].retention_class).toBe('operational');
  });
});

// -- Quarantine ----------------------------------------------------------

describe('dispatchAuditEvents — quarantine on EnvelopeMalformed (from sink)', () => {
  it('skips a row when the sink rejects as EnvelopeMalformed, advances past it, continues chain on next success', async () => {
    let writeCount = 0;
    const sink: import('./byWormSinkAdapter').SinkAdapter = {
      kind: 'test-malformed-on-second',
      async health() {
        return { healthy: true };
      },
      async write(envelope) {
        writeCount += 1;
        if (writeCount === 2) {
          throw new SinkError(
            'EnvelopeMalformed',
            'test-malformed-on-second',
            'fake reject',
            envelope,
          );
        }
        return {
          envelope_id: envelope.envelope_id,
          sink_kind: 'test-malformed-on-second',
          sink_attestation_id: `attestation-${writeCount}`,
          written_at_ms: 0,
          retention_class: envelope.retention_class,
          retention_until_ms: envelope.retention_until_ms,
        };
      },
    };

    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([
        makeRow({ audit_id: 'a', at_ms: 1000 }),
        makeRow({ audit_id: 'b', at_ms: 2000 }), // malformed at sink
        makeRow({ audit_id: 'c', at_ms: 3000 }),
      ]),
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    expect(result.succeeded.map((s) => s.row.audit_id)).toEqual(['a', 'c']);
    expect(result.quarantined.map((q) => q.row.audit_id)).toEqual(['b']);
    expect(result.haltedAt).toBeUndefined();
    expect(result.watermark).toBe(3000);
  });

  it('quarantines a row whose entity_kind is not in the v0.2 enum (builder rejects)', async () => {
    const sink = new ByWormNoOpAdapter({ collect: true });
    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([
        makeRow({ audit_id: 'good', at_ms: 1000 }),
        makeRow({ audit_id: 'bad', at_ms: 2000, entity_kind: 'rogue-kind' }),
        makeRow({ audit_id: 'good2', at_ms: 3000 }),
      ]),
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    expect(result.succeeded.map((s) => s.row.audit_id)).toEqual(['good', 'good2']);
    expect(result.quarantined.map((q) => q.row.audit_id)).toEqual(['bad']);
    expect(sink.getCollected().map((e) => e.audit_id)).toEqual(['good', 'good2']);
  });
});

// -- Halt on non-malformed errors ---------------------------------------

describe('dispatchAuditEvents — halt on non-malformed SinkError', () => {
  it('halts batch on SinkRetryable, returns succeeded + haltedAt, nextPrior reflects last success', async () => {
    let writeCount = 0;
    const sink: import('./byWormSinkAdapter').SinkAdapter = {
      kind: 'test-retryable-on-third',
      async health() {
        return { healthy: true };
      },
      async write(envelope) {
        writeCount += 1;
        if (writeCount === 3) {
          throw new SinkError('SinkRetryable', 'test-retryable-on-third', 'transient');
        }
        return {
          envelope_id: envelope.envelope_id,
          sink_kind: 'test-retryable-on-third',
          sink_attestation_id: `attestation-${writeCount}`,
          written_at_ms: 0,
          retention_class: envelope.retention_class,
          retention_until_ms: envelope.retention_until_ms,
        };
      },
    };

    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([
        makeRow({ audit_id: 'a', at_ms: 1000 }),
        makeRow({ audit_id: 'b', at_ms: 2000 }),
        makeRow({ audit_id: 'c', at_ms: 3000 }),
        makeRow({ audit_id: 'd', at_ms: 4000 }),
      ]),
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });

    expect(result.succeeded.map((s) => s.row.audit_id)).toEqual(['a', 'b']);
    expect(result.haltedAt?.row.audit_id).toBe('c');
    expect(result.haltedAt?.error.kind).toBe('SinkRetryable');
    expect(result.watermark).toBe(2000); // last success
    expect(result.nextPrior?.envelopeId).toBe(result.succeeded[1].envelope.envelope_id);
  });

  it('halts on SinkRejected', async () => {
    const sink: import('./byWormSinkAdapter').SinkAdapter = {
      kind: 'test-rejected',
      async health() {
        return { healthy: true };
      },
      async write() {
        throw new SinkError('SinkRejected', 'test-rejected', 'auth');
      },
    };

    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([makeRow({ audit_id: 'a', at_ms: 1000 })]),
      sink,
      sinceMs: 500,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });
    expect(result.succeeded).toHaveLength(0);
    expect(result.haltedAt?.error.kind).toBe('SinkRejected');
    expect(result.watermark).toBe(500); // unchanged
    expect(result.nextPrior).toBeNull();
  });

  it('wraps a non-SinkError thrown by an adapter as SinkUnavailable', async () => {
    const sink: import('./byWormSinkAdapter').SinkAdapter = {
      kind: 'test-throws-plain-error',
      async health() {
        return { healthy: true };
      },
      async write() {
        throw new Error('boom');
      },
    };

    const result = await dispatchAuditEvents({
      ...freshDispatchInputs(),
      source: new InMemorySource([makeRow({ audit_id: 'a', at_ms: 1000 })]),
      sink,
      sinceMs: 0,
      prior: null,
      retentionUntilMsFor: () => 2_000_000_000_000,
    });
    expect(result.haltedAt?.error.kind).toBe('SinkUnavailable');
    expect(result.haltedAt?.error.message).toMatch(/non-SinkError/);
  });
});
