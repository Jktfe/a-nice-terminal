import { describe, expect, it } from 'vitest';

import {
  type AuditEventRow,
  buildEnvelopeFromAuditEvent,
  envelopeChainHash,
} from './byWormEnvelopeBuilder';
import {
  AUDIT_ENVELOPE_VERSION,
  canonicalEnvelopeForChainHash,
  canonicalEnvelopeForSigning,
  isAuditEnvelope,
} from './byWormSinkAdapter';
import { sha256Hex } from './identityKeysStore';

function makeRow(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    audit_id: 'aud_test_001',
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
    ...overrides,
  };
}

// Deterministic signing function for tests — returns a fixed mark so we
// can assert what was signed without setting up an ed25519 keypair.
let signedPayloads: string[] = [];
function fakeSign(canonical: string): string {
  signedPayloads.push(canonical);
  return `fake-sig-of:${sha256Hex(canonical).slice(0, 12)}`;
}

describe('buildEnvelopeFromAuditEvent — happy path', () => {
  it('produces a fully-formed AuditEnvelope from an audit_events row', () => {
    signedPayloads = [];
    const env = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_nmvc',
      prior: null,
      signingKeyId: 'key_device_01',
      signFn: fakeSign,
      producedBy: 'ant-server',
      retentionUntilMs: 2_000_000_000_000,
      now: () => 1_780_000_001_000,
      envelopeIdFactory: () => 'env_fixed_001',
    });

    expect(isAuditEnvelope(env)).toBe(true);
    expect(env.envelope_version).toBe(AUDIT_ENVELOPE_VERSION);
    expect(env.envelope_id).toBe('env_fixed_001');
    expect(env.tenant_id).toBe('org_nmvc');
    expect(env.audit_id).toBe('aud_test_001');
    expect(env.signing_key_id).toBe('key_device_01');
    expect(env.produced_by).toBe('ant-server');
    expect(env.produced_at_ms).toBe(1_780_000_001_000);
    expect(env.retention_class).toBe('governance'); // default
    expect(env.retention_until_ms).toBe(2_000_000_000_000);
  });

  it('mirrors the row content verbatim into envelope.event', () => {
    const row = makeRow({
      kind: 'membership.joined',
      entity_kind: 'membership',
      entity_id: 'mem_abc',
      actor_agent_id: 'agt_inviter',
      before_json: '{}',
      after_json: '{"joined_at":123}',
      request_id: 'req_x',
      ip_hash: 'sha256:hash',
      challenge_proof: 'proof:abc',
    });

    const env = buildEnvelopeFromAuditEvent({
      row,
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 'sig',
      producedBy: 'ant-server',
      retentionUntilMs: 9_999_999_999_999,
    });

    expect(env.event.at_ms).toBe(row.at_ms);
    expect(env.event.kind).toBe(row.kind);
    expect(env.event.entity_kind).toBe(row.entity_kind);
    expect(env.event.entity_id).toBe(row.entity_id);
    expect(env.event.actor_agent_id).toBe(row.actor_agent_id);
    expect(env.event.before_json).toBe(row.before_json);
    expect(env.event.after_json).toBe(row.after_json);
    expect(env.event.request_id).toBe(row.request_id);
    expect(env.event.ip_hash).toBe(row.ip_hash);
    expect(env.event.challenge_proof).toBe(row.challenge_proof);
  });

  it('respects custom retentionClass when provided', () => {
    const env = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionClass: 'compliance',
      retentionUntilMs: 999,
    });
    expect(env.retention_class).toBe('compliance');
  });
});

describe('buildEnvelopeFromAuditEvent — chain linkage', () => {
  it('produces a genesis envelope when prior is null', () => {
    const env = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 999,
    });
    expect(env.prior_envelope_id).toBeNull();
    expect(env.prior_envelope_hash).toBeNull();
  });

  it('threads prior envelope context into prior_envelope_id + prior_envelope_hash', () => {
    const env = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_x',
      prior: { envelopeId: 'env_previous', envelopeHash: 'abc123' },
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 999,
    });
    expect(env.prior_envelope_id).toBe('env_previous');
    expect(env.prior_envelope_hash).toBe('abc123');
  });
});

describe('buildEnvelopeFromAuditEvent — signature placement', () => {
  it('signs the canonical-for-signing form (which excludes the signature itself)', () => {
    signedPayloads = [];
    const env = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: fakeSign,
      producedBy: 'ant-server',
      retentionUntilMs: 999,
      envelopeIdFactory: () => 'env_z',
    });

    expect(signedPayloads).toHaveLength(1);
    // The signed payload MUST NOT include the signature field
    expect(signedPayloads[0].includes('"signature"')).toBe(false);

    // And the produced signature is consistent with re-running the
    // canonical form on the same draft (sans the final signature value)
    const expectedSig = fakeSign(canonicalEnvelopeForSigning({ ...env, signature: '' }));
    // Note: fakeSign also pushes to signedPayloads — but the *value* of the
    // signature should match for identical inputs
    expect(env.signature).toBe(expectedSig);
  });

  it('signature is deterministic for a deterministic signFn (same row → same envelope shape)', () => {
    const row = makeRow();
    const env1 = buildEnvelopeFromAuditEvent({
      row,
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: (p) => `sig:${sha256Hex(p).slice(0, 8)}`,
      producedBy: 'ant-server',
      retentionUntilMs: 999,
      now: () => 1_780_000_000_000,
      envelopeIdFactory: () => 'env_fixed',
    });
    const env2 = buildEnvelopeFromAuditEvent({
      row,
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: (p) => `sig:${sha256Hex(p).slice(0, 8)}`,
      producedBy: 'ant-server',
      retentionUntilMs: 999,
      now: () => 1_780_000_000_000,
      envelopeIdFactory: () => 'env_fixed',
    });
    expect(env1).toEqual(env2);
  });
});

describe('buildEnvelopeFromAuditEvent — validation', () => {
  it('throws on unknown entity_kind (the audit_events CHECK should prevent this from escaping the DB, but guard defensively)', () => {
    const row = makeRow({ entity_kind: 'not-a-real-kind' });
    expect(() =>
      buildEnvelopeFromAuditEvent({
        row,
        tenantId: 'org_x',
        prior: null,
        signingKeyId: 'k1',
        signFn: () => 's',
        producedBy: 'ant-server',
        retentionUntilMs: 999,
      }),
    ).toThrow(/not-a-real-kind/);
  });
});

describe('envelopeChainHash', () => {
  it('returns SHA-256 hex of the canonical-with-signature form', () => {
    const env = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 'fixed-sig',
      producedBy: 'ant-server',
      retentionUntilMs: 999,
      now: () => 1_780_000_000_000,
      envelopeIdFactory: () => 'env_fixed',
    });

    const expected = sha256Hex(canonicalEnvelopeForChainHash(env));
    expect(envelopeChainHash(env)).toBe(expected);
    expect(envelopeChainHash(env)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the signature changes (the re-signing tamper signal)', () => {
    const base = buildEnvelopeFromAuditEvent({
      row: makeRow(),
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 'sig-a',
      producedBy: 'ant-server',
      retentionUntilMs: 999,
      now: () => 1_780_000_000_000,
      envelopeIdFactory: () => 'env_fixed',
    });
    const reSigned = { ...base, signature: 'sig-b' };

    expect(envelopeChainHash(base)).not.toBe(envelopeChainHash(reSigned));
  });
});
