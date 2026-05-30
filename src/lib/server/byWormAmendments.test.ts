import { describe, expect, it } from 'vitest';

import {
  AMENDMENT_KINDS,
  type AmendmentEventInput,
  type AmendmentKind,
  type AmendmentReason,
  buildAmendmentEvent,
  getAmendmentKind,
  getAmendmentReason,
  getAmendmentTargetEnvelopeId,
  isAmendmentEnvelope,
  isAmendmentKind,
  isAmendmentReason,
} from './byWormAmendments';
import { buildEnvelopeFromAuditEvent } from './byWormEnvelopeBuilder';
import { AUDIT_ENVELOPE_VERSION, type AuditEnvelope } from './byWormSinkAdapter';

// -- Pure type-guard tests -----------------------------------------------

describe('AmendmentKind', () => {
  it('accepts all four known kinds', () => {
    for (const kind of AMENDMENT_KINDS) {
      expect(isAmendmentKind(kind)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isAmendmentKind('deleted')).toBe(false);
    expect(isAmendmentKind('')).toBe(false);
    expect(isAmendmentKind('SHREDDED')).toBe(false); // case sensitive
  });

  it('rejects non-strings', () => {
    expect(isAmendmentKind(null)).toBe(false);
    expect(isAmendmentKind(undefined)).toBe(false);
    expect(isAmendmentKind(42)).toBe(false);
  });
});

describe('AmendmentReason guard', () => {
  it('accepts a minimal reason', () => {
    const r: AmendmentReason = {
      code: 'gdpr-art-17',
      detail: 'user requested erasure',
      initiated_by_agent_id: 'agt_compliance_01',
    };
    expect(isAmendmentReason(r)).toBe(true);
  });

  it('accepts a reason with approver', () => {
    const r: AmendmentReason = {
      code: 'data-quality-incident-42',
      detail: 'wrong entity_id recorded by retry replay',
      initiated_by_agent_id: 'agt_ops_01',
      approved_by_agent_id: 'agt_compliance_chief',
    };
    expect(isAmendmentReason(r)).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(isAmendmentReason({ detail: 'd', initiated_by_agent_id: 'a' })).toBe(false);
    expect(isAmendmentReason({ code: 'c', initiated_by_agent_id: 'a' })).toBe(false);
    expect(isAmendmentReason({ code: 'c', detail: 'd' })).toBe(false);
  });

  it('rejects wrong-typed approver', () => {
    expect(
      isAmendmentReason({
        code: 'c',
        detail: 'd',
        initiated_by_agent_id: 'a',
        approved_by_agent_id: 123,
      }),
    ).toBe(false);
  });

  it('rejects null/undefined/primitives', () => {
    expect(isAmendmentReason(null)).toBe(false);
    expect(isAmendmentReason(undefined)).toBe(false);
    expect(isAmendmentReason('reason')).toBe(false);
  });
});

// -- buildAmendmentEvent ------------------------------------------------

describe('buildAmendmentEvent', () => {
  const baseInput: AmendmentEventInput = {
    originalEnvelopeId: 'env_original_001',
    kind: 'shredded',
    reason: {
      code: 'gdpr-art-17',
      detail: 'subject access request 2026-05-30',
      initiated_by_agent_id: 'agt_compliance_01',
    },
    audit_id: 'aud_amend_001',
    at_ms: 1_780_000_500_000,
  };

  it('produces a row with kind = amendment.<kind>', () => {
    const row = buildAmendmentEvent(baseInput);
    expect(row.kind).toBe('amendment.shredded');
  });

  it('sets entity_kind to "system" and entity_id to the original envelope_id', () => {
    const row = buildAmendmentEvent(baseInput);
    expect(row.entity_kind).toBe('system');
    expect(row.entity_id).toBe('env_original_001');
  });

  it('serialises the reason into after_json', () => {
    const row = buildAmendmentEvent(baseInput);
    expect(row.after_json).not.toBeNull();
    const parsed = JSON.parse(row.after_json as string);
    expect(parsed.code).toBe('gdpr-art-17');
    expect(parsed.initiated_by_agent_id).toBe('agt_compliance_01');
  });

  it('puts the initiating agent in actor_agent_id', () => {
    const row = buildAmendmentEvent(baseInput);
    expect(row.actor_agent_id).toBe('agt_compliance_01');
  });

  it('leaves before_json + request_id + ip_hash + challenge_proof null', () => {
    const row = buildAmendmentEvent(baseInput);
    expect(row.before_json).toBeNull();
    expect(row.request_id).toBeNull();
    expect(row.ip_hash).toBeNull();
    expect(row.challenge_proof).toBeNull();
    expect(row.actor_runtime_id).toBeNull();
  });

  it('threads audit_id + at_ms through', () => {
    const row = buildAmendmentEvent(baseInput);
    expect(row.audit_id).toBe('aud_amend_001');
    expect(row.at_ms).toBe(1_780_000_500_000);
  });

  it('produces distinct kind strings per AmendmentKind', () => {
    for (const kind of AMENDMENT_KINDS) {
      const row = buildAmendmentEvent({ ...baseInput, kind });
      expect(row.kind).toBe(`amendment.${kind}`);
    }
  });
});

// -- Round-trip through the envelope builder ----------------------------

function buildAmendmentEnvelope(input: AmendmentEventInput): AuditEnvelope {
  const row = buildAmendmentEvent(input);
  return buildEnvelopeFromAuditEvent({
    row,
    tenantId: 'org_nmvc',
    prior: null,
    signingKeyId: 'key_device_01',
    signFn: () => 'fixed-sig',
    producedBy: 'ant-server',
    retentionUntilMs: 2_000_000_000_000,
    now: () => 1_780_000_500_500,
    envelopeIdFactory: () => 'env_amend_001',
  });
}

describe('amendment envelopes — predicates round-trip', () => {
  const input: AmendmentEventInput = {
    originalEnvelopeId: 'env_original_001',
    kind: 'shredded',
    reason: {
      code: 'gdpr-art-17',
      detail: 'subject access request 2026-05-30',
      initiated_by_agent_id: 'agt_compliance_01',
    },
    audit_id: 'aud_amend_001',
    at_ms: 1_780_000_500_000,
  };

  it('isAmendmentEnvelope is true for an amendment envelope', () => {
    const env = buildAmendmentEnvelope(input);
    expect(isAmendmentEnvelope(env)).toBe(true);
  });

  it('isAmendmentEnvelope is false for a regular event envelope', () => {
    const regular = buildEnvelopeFromAuditEvent({
      row: {
        audit_id: 'aud_regular',
        at_ms: 1000,
        kind: 'agent.created',
        entity_kind: 'agent',
        entity_id: 'agt_x',
        actor_agent_id: null,
        actor_runtime_id: null,
        before_json: null,
        after_json: null,
        request_id: null,
        ip_hash: null,
        challenge_proof: null,
      },
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
    });
    expect(isAmendmentEnvelope(regular)).toBe(false);
  });

  it('isAmendmentEnvelope is false when entity_kind is not system (defends against future kind collisions)', () => {
    // Force-craft an envelope that LOOKS like an amendment by kind but
    // has entity_kind='agent'. Should NOT be classified as an amendment.
    const env = buildEnvelopeFromAuditEvent({
      row: {
        audit_id: 'aud_x',
        at_ms: 1000,
        kind: 'amendment.shredded', // misleading kind
        entity_kind: 'agent', // but not system entity
        entity_id: 'agt_x',
        actor_agent_id: null,
        actor_runtime_id: null,
        before_json: null,
        after_json: null,
        request_id: null,
        ip_hash: null,
        challenge_proof: null,
      },
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
    });
    expect(isAmendmentEnvelope(env)).toBe(false);
  });

  it('getAmendmentTargetEnvelopeId returns the original envelope_id', () => {
    const env = buildAmendmentEnvelope(input);
    expect(getAmendmentTargetEnvelopeId(env)).toBe('env_original_001');
  });

  it('getAmendmentTargetEnvelopeId returns null for non-amendment', () => {
    const regular = buildEnvelopeFromAuditEvent({
      row: {
        audit_id: 'aud_regular',
        at_ms: 1000,
        kind: 'agent.created',
        entity_kind: 'agent',
        entity_id: 'agt_x',
        actor_agent_id: null,
        actor_runtime_id: null,
        before_json: null,
        after_json: null,
        request_id: null,
        ip_hash: null,
        challenge_proof: null,
      },
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
    });
    expect(getAmendmentTargetEnvelopeId(regular)).toBeNull();
  });

  it('getAmendmentKind returns the kind for every AmendmentKind', () => {
    for (const kind of AMENDMENT_KINDS) {
      const env = buildAmendmentEnvelope({ ...input, kind });
      expect(getAmendmentKind(env)).toBe(kind);
    }
  });

  it('getAmendmentKind returns null when the suffix is not a known kind (fail-closed on unknown future kinds)', () => {
    // Build an envelope whose event.kind looks amendment-shaped but uses
    // a future kind we don't yet recognise. Predicates should fail-closed.
    const env = buildEnvelopeFromAuditEvent({
      row: {
        audit_id: 'aud_future',
        at_ms: 1000,
        kind: 'amendment.future-kind-we-dont-know',
        entity_kind: 'system',
        entity_id: 'env_x',
        actor_agent_id: null,
        actor_runtime_id: null,
        before_json: null,
        after_json: null,
        request_id: null,
        ip_hash: null,
        challenge_proof: null,
      },
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
    });
    // isAmendmentEnvelope still true (it has the right shape)
    expect(isAmendmentEnvelope(env)).toBe(true);
    // but getAmendmentKind returns null (we don't recognise the kind)
    expect(getAmendmentKind(env)).toBeNull();
  });

  it('getAmendmentReason round-trips through JSON', () => {
    const env = buildAmendmentEnvelope(input);
    const reason = getAmendmentReason(env);
    expect(reason).not.toBeNull();
    expect(reason?.code).toBe('gdpr-art-17');
    expect(reason?.detail).toBe('subject access request 2026-05-30');
    expect(reason?.initiated_by_agent_id).toBe('agt_compliance_01');
  });

  it('getAmendmentReason preserves approved_by_agent_id', () => {
    const env = buildAmendmentEnvelope({
      ...input,
      reason: { ...input.reason, approved_by_agent_id: 'agt_chief_compliance' },
    });
    expect(getAmendmentReason(env)?.approved_by_agent_id).toBe('agt_chief_compliance');
  });

  it('getAmendmentReason returns null on malformed JSON', () => {
    // Hand-craft an envelope whose after_json is not valid JSON
    const env = buildEnvelopeFromAuditEvent({
      row: {
        audit_id: 'aud_bad_json',
        at_ms: 1000,
        kind: 'amendment.shredded',
        entity_kind: 'system',
        entity_id: 'env_x',
        actor_agent_id: 'a',
        actor_runtime_id: null,
        before_json: null,
        after_json: '{not valid json',
        request_id: null,
        ip_hash: null,
        challenge_proof: null,
      },
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
    });
    expect(getAmendmentReason(env)).toBeNull();
  });

  it('getAmendmentReason returns null when after_json has wrong shape', () => {
    const env = buildEnvelopeFromAuditEvent({
      row: {
        audit_id: 'aud_wrong_shape',
        at_ms: 1000,
        kind: 'amendment.shredded',
        entity_kind: 'system',
        entity_id: 'env_x',
        actor_agent_id: 'a',
        actor_runtime_id: null,
        before_json: null,
        after_json: JSON.stringify({ unrelated: 'shape' }),
        request_id: null,
        ip_hash: null,
        challenge_proof: null,
      },
      tenantId: 'org_x',
      prior: null,
      signingKeyId: 'k1',
      signFn: () => 's',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
    });
    expect(getAmendmentReason(env)).toBeNull();
  });

  it('amendments can themselves be amended (DAG: amendment-of-amendment)', () => {
    // First amendment: shred envelope_id 'env_001'
    const firstAmendment = buildAmendmentEnvelope({
      originalEnvelopeId: 'env_001',
      kind: 'shredded',
      reason: input.reason,
      audit_id: 'aud_amend_1',
      at_ms: 1000,
    });

    // Second amendment: void the first amendment (e.g. shred was issued
    // in error and the chief compliance officer voids it). The second
    // amendment's entity_id is the FIRST amendment's envelope_id.
    const secondAmendment = buildEnvelopeFromAuditEvent({
      row: buildAmendmentEvent({
        originalEnvelopeId: firstAmendment.envelope_id,
        kind: 'voided',
        reason: {
          code: 'shred-issued-in-error',
          detail: 'compliance officer revoked shred 30 min after issue',
          initiated_by_agent_id: 'agt_chief_compliance',
        },
        audit_id: 'aud_amend_2',
        at_ms: 2000,
      }),
      tenantId: 'org_x',
      prior: {
        envelopeId: firstAmendment.envelope_id,
        envelopeHash: 'firsthash',
      },
      signingKeyId: 'k1',
      signFn: () => 's2',
      producedBy: 'ant-server',
      retentionUntilMs: 9999,
      envelopeIdFactory: () => 'env_amend_2',
    });

    expect(isAmendmentEnvelope(secondAmendment)).toBe(true);
    expect(getAmendmentKind(secondAmendment)).toBe('voided');
    expect(getAmendmentTargetEnvelopeId(secondAmendment)).toBe(firstAmendment.envelope_id);
  });
});
