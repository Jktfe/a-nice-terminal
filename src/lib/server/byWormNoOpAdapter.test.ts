import { describe, expect, it } from 'vitest';
import { ByWormNoOpAdapter } from './byWormNoOpAdapter';
import { AUDIT_ENVELOPE_VERSION, SinkError, type AuditEnvelope } from './byWormSinkAdapter';

function makeEnvelope(overrides: Partial<AuditEnvelope> = {}): AuditEnvelope {
  return {
    envelope_id: 'env_test_001',
    envelope_version: AUDIT_ENVELOPE_VERSION,
    tenant_id: 'org_nmvc',
    audit_id: 'aud_test_001',
    event: {
      at_ms: 1_780_000_000_000,
      kind: 'agent.created',
      entity_kind: 'agent',
      entity_id: 'agt_001',
      actor_agent_id: 'agt_admin',
      actor_runtime_id: 'rt_abc',
      before_json: null,
      after_json: '{"handle":"@test"}',
      request_id: null,
      ip_hash: null,
      challenge_proof: null,
    },
    prior_envelope_id: null,
    prior_envelope_hash: null,
    signing_key_id: 'key_device_01',
    signature: 'base64sig==',
    retention_class: 'compliance',
    retention_until_ms: 1_780_000_000_000 + 7 * 365 * 24 * 3600 * 1000,
    produced_at_ms: 1_780_000_000_500,
    produced_by: 'ant-server',
    ...overrides,
  };
}

describe('ByWormNoOpAdapter — kind + health', () => {
  it('identifies as kind="no-op"', () => {
    const adapter = new ByWormNoOpAdapter();
    expect(adapter.kind).toBe('no-op');
  });

  it('reports healthy by default', async () => {
    const adapter = new ByWormNoOpAdapter();
    await expect(adapter.health()).resolves.toEqual({ healthy: true });
  });

  it('reports unhealthy when configured to fail with SinkUnavailable', async () => {
    const adapter = new ByWormNoOpAdapter({ failWith: 'SinkUnavailable' });
    const h = await adapter.health();
    expect(h.healthy).toBe(false);
    expect(h.detail).toMatch(/SinkUnavailable/);
  });
});

describe('ByWormNoOpAdapter — write', () => {
  it('returns a receipt that mirrors the envelope retention policy', async () => {
    const adapter = new ByWormNoOpAdapter({ now: () => 1_780_000_001_000 });
    const env = makeEnvelope();
    const receipt = await adapter.write(env);

    expect(receipt.envelope_id).toBe(env.envelope_id);
    expect(receipt.sink_kind).toBe('no-op');
    expect(receipt.sink_attestation_id).toBe('no-op-attestation-1');
    expect(receipt.written_at_ms).toBe(1_780_000_001_000);
    expect(receipt.retention_class).toBe(env.retention_class);
    expect(receipt.retention_until_ms).toBe(env.retention_until_ms);
  });

  it('issues monotonically-increasing attestation ids', async () => {
    const adapter = new ByWormNoOpAdapter();
    const r1 = await adapter.write(makeEnvelope({ envelope_id: 'env_001' }));
    const r2 = await adapter.write(makeEnvelope({ envelope_id: 'env_002' }));
    expect(r1.sink_attestation_id).toBe('no-op-attestation-1');
    expect(r2.sink_attestation_id).toBe('no-op-attestation-2');
  });

  it('rejects a malformed envelope with EnvelopeMalformed', async () => {
    const adapter = new ByWormNoOpAdapter();
    const bad = { ...makeEnvelope(), envelope_version: '2.0' } as unknown as AuditEnvelope;
    await expect(adapter.write(bad)).rejects.toBeInstanceOf(SinkError);
    await expect(adapter.write(bad)).rejects.toMatchObject({ kind: 'EnvelopeMalformed' });
  });

  it('throws the configured SinkError kind on every write', async () => {
    for (const kind of ['SinkUnavailable', 'SinkRejected', 'SinkRetryable'] as const) {
      const adapter = new ByWormNoOpAdapter({ failWith: kind });
      await expect(adapter.write(makeEnvelope())).rejects.toMatchObject({
        kind,
        sinkKind: 'no-op',
      });
    }
  });
});

describe('ByWormNoOpAdapter — collect mode', () => {
  it('does not retain envelopes when collect=false', async () => {
    const adapter = new ByWormNoOpAdapter();
    await adapter.write(makeEnvelope());
    expect(adapter.getCollected()).toEqual([]);
  });

  it('retains envelopes in order when collect=true', async () => {
    const adapter = new ByWormNoOpAdapter({ collect: true });
    const e1 = makeEnvelope({ envelope_id: 'env_001' });
    const e2 = makeEnvelope({ envelope_id: 'env_002' });
    const e3 = makeEnvelope({ envelope_id: 'env_003' });
    await adapter.write(e1);
    await adapter.write(e2);
    await adapter.write(e3);
    const collected = adapter.getCollected();
    expect(collected.map((e) => e.envelope_id)).toEqual(['env_001', 'env_002', 'env_003']);
  });

  it('returns a defensive copy (mutation of caller copy does not mutate internal state)', async () => {
    const adapter = new ByWormNoOpAdapter({ collect: true });
    await adapter.write(makeEnvelope());
    const snapshot = adapter.getCollected();
    snapshot.length = 0;
    expect(adapter.getCollected()).toHaveLength(1);
  });

  it('clearCollected wipes the in-memory record', async () => {
    const adapter = new ByWormNoOpAdapter({ collect: true });
    await adapter.write(makeEnvelope());
    expect(adapter.getCollected()).toHaveLength(1);
    adapter.clearCollected();
    expect(adapter.getCollected()).toHaveLength(0);
  });
});
