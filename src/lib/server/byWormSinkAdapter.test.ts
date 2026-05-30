import { describe, expect, it } from 'vitest';
import {
  AUDIT_ENVELOPE_VERSION,
  RETENTION_CLASSES,
  canonicalEnvelopeForChainHash,
  canonicalEnvelopeForSigning,
  isAuditEnvelope,
  isAuditEventCore,
  isRetentionClass,
  isSinkReceipt,
  type AuditEnvelope,
  type AuditEventCore,
  type SinkReceipt,
} from './byWormSinkAdapter';

const baseEvent: AuditEventCore = {
  at_ms: 1_780_000_000_000,
  kind: 'agent.created',
  entity_kind: 'agent',
  entity_id: 'agt_01H9X',
  actor_agent_id: 'agt_admin',
  actor_runtime_id: 'rt_abc',
  before_json: null,
  after_json: '{"handle":"@enterprisec"}',
  request_id: 'req_xyz',
  ip_hash: 'sha256:abc...',
  challenge_proof: null,
};

const baseEnvelope: AuditEnvelope = {
  envelope_id: 'env_01H9X',
  envelope_version: AUDIT_ENVELOPE_VERSION,
  tenant_id: 'org_nmvc',
  audit_id: 'aud_01H9X',
  event: baseEvent,
  prior_envelope_id: null,
  prior_envelope_hash: null,
  signing_key_id: 'key_device_01',
  signature: 'base64sig==',
  retention_class: 'compliance',
  retention_until_ms: 1_780_000_000_000 + 7 * 365 * 24 * 3600 * 1000,
  produced_at_ms: 1_780_000_000_500,
  produced_by: 'ant-server',
};

describe('byWormSinkAdapter — retention class', () => {
  it('accepts compliance, governance, operational', () => {
    for (const c of RETENTION_CLASSES) {
      expect(isRetentionClass(c)).toBe(true);
    }
  });

  it('rejects unknown retention classes', () => {
    expect(isRetentionClass('best-effort')).toBe(false);
    expect(isRetentionClass('')).toBe(false);
    expect(isRetentionClass(undefined)).toBe(false);
    expect(isRetentionClass(null)).toBe(false);
  });
});

describe('byWormSinkAdapter — AuditEventCore guard', () => {
  it('accepts a well-formed event', () => {
    expect(isAuditEventCore(baseEvent)).toBe(true);
  });

  it('accepts nulls in the documented nullable fields', () => {
    const e: AuditEventCore = {
      ...baseEvent,
      actor_agent_id: null,
      actor_runtime_id: null,
      before_json: null,
      after_json: null,
      request_id: null,
      ip_hash: null,
      challenge_proof: null,
    };
    expect(isAuditEventCore(e)).toBe(true);
  });

  it('rejects missing required fields', () => {
    const broken = { ...baseEvent } as Partial<AuditEventCore>;
    delete broken.kind;
    expect(isAuditEventCore(broken)).toBe(false);
  });

  it('rejects wrong-typed fields', () => {
    expect(isAuditEventCore({ ...baseEvent, at_ms: 'now' })).toBe(false);
    expect(isAuditEventCore({ ...baseEvent, entity_id: 123 })).toBe(false);
  });

  it('rejects null/undefined/primitives', () => {
    expect(isAuditEventCore(null)).toBe(false);
    expect(isAuditEventCore(undefined)).toBe(false);
    expect(isAuditEventCore('not-an-object')).toBe(false);
  });
});

describe('byWormSinkAdapter — AuditEnvelope guard', () => {
  it('accepts a well-formed envelope', () => {
    expect(isAuditEnvelope(baseEnvelope)).toBe(true);
  });

  it('accepts a genesis envelope (null prior_envelope_id + null prior_envelope_hash)', () => {
    const genesis: AuditEnvelope = {
      ...baseEnvelope,
      prior_envelope_id: null,
      prior_envelope_hash: null,
    };
    expect(isAuditEnvelope(genesis)).toBe(true);
  });

  it('rejects an envelope with the wrong version', () => {
    expect(isAuditEnvelope({ ...baseEnvelope, envelope_version: '2.0' })).toBe(false);
  });

  it('rejects an envelope with an unknown retention_class', () => {
    expect(isAuditEnvelope({ ...baseEnvelope, retention_class: 'best-effort' })).toBe(false);
  });

  it('rejects an envelope whose event payload is malformed', () => {
    expect(
      isAuditEnvelope({ ...baseEnvelope, event: { ...baseEvent, at_ms: 'NaN' } }),
    ).toBe(false);
  });

  it('rejects null/undefined/primitives', () => {
    expect(isAuditEnvelope(null)).toBe(false);
    expect(isAuditEnvelope(undefined)).toBe(false);
    expect(isAuditEnvelope(42)).toBe(false);
  });
});

describe('byWormSinkAdapter — SinkReceipt guard', () => {
  const receipt: SinkReceipt = {
    envelope_id: 'env_01H9X',
    sink_kind: 's3-object-lock',
    sink_attestation_id: 'arn:aws:s3:...:obj',
    written_at_ms: 1_780_000_000_900,
    retention_class: 'compliance',
    retention_until_ms: 1_780_000_000_000 + 7 * 365 * 24 * 3600 * 1000,
  };

  it('accepts a well-formed receipt', () => {
    expect(isSinkReceipt(receipt)).toBe(true);
  });

  it('rejects a receipt with an unknown retention class', () => {
    expect(isSinkReceipt({ ...receipt, retention_class: 'best-effort' })).toBe(false);
  });

  it('rejects a receipt missing the attestation id', () => {
    const broken = { ...receipt } as Partial<SinkReceipt>;
    delete broken.sink_attestation_id;
    expect(isSinkReceipt(broken)).toBe(false);
  });
});

describe('byWormSinkAdapter — canonical forms', () => {
  it('canonicalEnvelopeForSigning excludes the signature field', () => {
    const canonical = canonicalEnvelopeForSigning(baseEnvelope);
    expect(canonical.includes('"signature"')).toBe(false);
    expect(canonical.includes(baseEnvelope.signature)).toBe(false);
  });

  it('canonicalEnvelopeForSigning is deterministic across key ordering', () => {
    const reordered: AuditEnvelope = {
      // Same values, different declaration order
      produced_by: baseEnvelope.produced_by,
      produced_at_ms: baseEnvelope.produced_at_ms,
      retention_until_ms: baseEnvelope.retention_until_ms,
      retention_class: baseEnvelope.retention_class,
      signature: baseEnvelope.signature,
      signing_key_id: baseEnvelope.signing_key_id,
      prior_envelope_hash: baseEnvelope.prior_envelope_hash,
      prior_envelope_id: baseEnvelope.prior_envelope_id,
      event: baseEnvelope.event,
      audit_id: baseEnvelope.audit_id,
      tenant_id: baseEnvelope.tenant_id,
      envelope_version: baseEnvelope.envelope_version,
      envelope_id: baseEnvelope.envelope_id,
    };
    expect(canonicalEnvelopeForSigning(reordered)).toBe(canonicalEnvelopeForSigning(baseEnvelope));
  });

  it('canonicalEnvelopeForChainHash includes the signature field (chain detects re-signing)', () => {
    const canonical = canonicalEnvelopeForChainHash(baseEnvelope);
    expect(canonical.includes('"signature"')).toBe(true);
    expect(canonical.includes(baseEnvelope.signature)).toBe(true);
  });
});
