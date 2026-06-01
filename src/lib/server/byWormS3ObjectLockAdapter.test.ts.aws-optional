import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import {
  ByWormS3ObjectLockAdapter,
  buildAttestation,
  defaultRetentionModeFor,
  mapAwsErrorToSinkError,
  objectKeyFor,
} from './byWormS3ObjectLockAdapter';
import { AUDIT_ENVELOPE_VERSION, SinkError, type AuditEnvelope } from './byWormSinkAdapter';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

function makeEnvelope(overrides: Partial<AuditEnvelope> = {}): AuditEnvelope {
  return {
    envelope_id: 'env_01H9X',
    envelope_version: AUDIT_ENVELOPE_VERSION,
    tenant_id: 'org_nmvc',
    audit_id: 'aud_01H9X',
    event: {
      // 2026-05-30 12:34:56 UTC (deterministic for key format tests)
      at_ms: Date.UTC(2026, 4, 30, 12, 34, 56),
      kind: 'agent.created',
      entity_kind: 'agent',
      entity_id: 'agt_01H9X',
      actor_agent_id: 'agt_admin',
      actor_runtime_id: 'rt_abc',
      before_json: null,
      after_json: '{"handle":"@enterprisec"}',
      request_id: null,
      ip_hash: null,
      challenge_proof: null,
    },
    prior_envelope_id: null,
    prior_envelope_hash: null,
    signing_key_id: 'key_device_01',
    signature: 'base64sig==',
    retention_class: 'compliance',
    retention_until_ms: Date.UTC(2026, 4, 30) + 7 * 365 * 24 * 3600 * 1000,
    produced_at_ms: Date.UTC(2026, 4, 30, 12, 35, 0),
    produced_by: 'ant-server',
    ...overrides,
  };
}

// -- Pure helpers -------------------------------------------------------

describe('defaultRetentionModeFor', () => {
  it('maps compliance → COMPLIANCE', () => {
    expect(defaultRetentionModeFor('compliance')).toBe('COMPLIANCE');
  });

  it('maps governance → GOVERNANCE', () => {
    expect(defaultRetentionModeFor('governance')).toBe('GOVERNANCE');
  });

  it('maps operational → GOVERNANCE', () => {
    expect(defaultRetentionModeFor('operational')).toBe('GOVERNANCE');
  });
});

describe('objectKeyFor', () => {
  it('formats <tenant>/<YYYY>/<MM>/<DD>/<envelope_id>.json based on event.at_ms', () => {
    const env = makeEnvelope({
      envelope_id: 'env_abc',
      tenant_id: 'org_nmvc',
      event: { ...makeEnvelope().event, at_ms: Date.UTC(2026, 0, 5, 9, 0, 0) },
    });
    expect(objectKeyFor(env)).toBe('org_nmvc/2026/01/05/env_abc.json');
  });

  it('uses event.at_ms (NOT produced_at_ms) for the date partition', () => {
    // Event happened in March; envelope was produced in May (e.g. backfill).
    // The key MUST reflect when the event happened, not when it was wrapped.
    const env = makeEnvelope({
      envelope_id: 'env_backfill',
      tenant_id: 'org_x',
      event: { ...makeEnvelope().event, at_ms: Date.UTC(2026, 2, 15) },
      produced_at_ms: Date.UTC(2026, 4, 30),
    });
    expect(objectKeyFor(env)).toBe('org_x/2026/03/15/env_backfill.json');
  });

  it('pads single-digit month and day with zeros', () => {
    const env = makeEnvelope({
      envelope_id: 'env_1',
      tenant_id: 'org_1',
      event: { ...makeEnvelope().event, at_ms: Date.UTC(2026, 0, 1) }, // Jan 1
    });
    expect(objectKeyFor(env)).toBe('org_1/2026/01/01/env_1.json');
  });

  it('applies keyPrefix when provided', () => {
    const env = makeEnvelope({
      envelope_id: 'env_x',
      tenant_id: 'org_x',
      event: { ...makeEnvelope().event, at_ms: Date.UTC(2026, 4, 30) },
    });
    expect(objectKeyFor(env, 'prod')).toBe('prod/org_x/2026/05/30/env_x.json');
  });

  it('normalises keyPrefix (strips leading slash, ensures exactly one trailing slash)', () => {
    const env = makeEnvelope({
      envelope_id: 'env_x',
      tenant_id: 'org_x',
      event: { ...makeEnvelope().event, at_ms: Date.UTC(2026, 4, 30) },
    });
    expect(objectKeyFor(env, '/prod/')).toBe('prod/org_x/2026/05/30/env_x.json');
    expect(objectKeyFor(env, '//prod//')).toBe('prod/org_x/2026/05/30/env_x.json');
    expect(objectKeyFor(env, '   ')).toBe('org_x/2026/05/30/env_x.json');
  });

  it('uses UTC for the date partition (DST-stable)', () => {
    // At UTC midnight on the 30th, local time in Europe/London (DST=BST) is
    // 01:00 on the 30th. At 23:00 UTC on the 30th, BST is 00:00 on the 31st.
    // The partition MUST track UTC, not local — auditors querying by date
    // expect calendar-day-UTC partitions.
    const env = makeEnvelope({
      envelope_id: 'env_late',
      tenant_id: 'org_x',
      event: { ...makeEnvelope().event, at_ms: Date.UTC(2026, 4, 30, 23, 30, 0) },
    });
    expect(objectKeyFor(env)).toBe('org_x/2026/05/30/env_late.json');
  });
});

describe('buildAttestation', () => {
  it('returns s3://<bucket>/<key> when no versionId', () => {
    expect(buildAttestation('my-bucket', 'org/2026/05/30/env_x.json')).toBe(
      's3://my-bucket/org/2026/05/30/env_x.json',
    );
  });

  it('appends ?versionId=<id> when version returned', () => {
    expect(buildAttestation('my-bucket', 'key', 'v1abc')).toBe(
      's3://my-bucket/key?versionId=v1abc',
    );
  });
});

describe('mapAwsErrorToSinkError', () => {
  it('maps 5xx → SinkRetryable', () => {
    const err = { name: 'InternalError', message: 'oops', $metadata: { httpStatusCode: 503 } };
    const mapped = mapAwsErrorToSinkError(err, 's3-object-lock');
    expect(mapped).toBeInstanceOf(SinkError);
    expect(mapped.kind).toBe('SinkRetryable');
  });

  it('maps ThrottlingException → SinkRetryable', () => {
    const err = { name: 'ThrottlingException', message: 'slow down', $metadata: { httpStatusCode: 429 } };
    expect(mapAwsErrorToSinkError(err, 's3-object-lock').kind).toBe('SinkRetryable');
  });

  it('maps SlowDown → SinkRetryable', () => {
    const err = { name: 'SlowDown', message: 's3 throttle', $metadata: { httpStatusCode: 503 } };
    expect(mapAwsErrorToSinkError(err, 's3-object-lock').kind).toBe('SinkRetryable');
  });

  it('maps 4xx auth/quota → SinkRejected', () => {
    const err = { name: 'AccessDenied', message: 'nope', $metadata: { httpStatusCode: 403 } };
    expect(mapAwsErrorToSinkError(err, 's3-object-lock').kind).toBe('SinkRejected');
  });

  it('maps NetworkingError → SinkUnavailable', () => {
    const err = { name: 'NetworkingError', message: 'connection refused' };
    expect(mapAwsErrorToSinkError(err, 's3-object-lock').kind).toBe('SinkUnavailable');
  });

  it('defaults unknown errors with no status to SinkUnavailable', () => {
    const err = { message: 'mystery' };
    expect(mapAwsErrorToSinkError(err, 's3-object-lock').kind).toBe('SinkUnavailable');
  });

  it('captures the original error in detail', () => {
    const original = { name: 'AccessDenied', message: 'nope', $metadata: { httpStatusCode: 403 } };
    const mapped = mapAwsErrorToSinkError(original, 's3-object-lock');
    expect(mapped.detail).toBe(original);
    expect(mapped.sinkKind).toBe('s3-object-lock');
  });
});

// -- Adapter integration with mocked S3 client -------------------------

describe('ByWormS3ObjectLockAdapter — constructor', () => {
  it('throws when region is missing', () => {
    const s3 = new S3Client({});
    expect(
      () =>
        new ByWormS3ObjectLockAdapter({
          region: '',
          bucket: 'b',
          s3Client: s3,
        }),
    ).toThrow(/region/);
  });

  it('throws when bucket is missing', () => {
    const s3 = new S3Client({});
    expect(
      () =>
        new ByWormS3ObjectLockAdapter({
          region: 'us-east-1',
          bucket: '',
          s3Client: s3,
        }),
    ).toThrow(/bucket/);
  });

  it('throws when s3Client is missing', () => {
    expect(
      () =>
        new ByWormS3ObjectLockAdapter({
          region: 'us-east-1',
          bucket: 'b',
          // @ts-expect-error — intentionally missing for the test
          s3Client: undefined,
        }),
    ).toThrow(/s3Client/);
  });
});

describe('ByWormS3ObjectLockAdapter — health', () => {
  it('reports healthy when HeadBucket succeeds', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
    });
    await expect(adapter.health()).resolves.toEqual({ healthy: true });
  });

  it('reports unhealthy when HeadBucket fails', async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error('NotFound'));
    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
    });
    const h = await adapter.health();
    expect(h.healthy).toBe(false);
    expect(h.detail).toMatch(/ant-audit/);
  });
});

describe('ByWormS3ObjectLockAdapter — write', () => {
  it('issues PutObject with the right Bucket + Key + ObjectLockMode + RetainUntilDate', async () => {
    s3Mock.on(PutObjectCommand).resolves({ VersionId: 'v1abc' });

    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
      now: () => 1_780_000_010_000,
    });

    const env = makeEnvelope();
    const receipt = await adapter.write(env);

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;

    expect(input.Bucket).toBe('ant-audit');
    expect(input.Key).toBe(objectKeyFor(env));
    expect(input.ContentType).toBe('application/json');
    expect(input.ObjectLockMode).toBe('COMPLIANCE'); // compliance retention class
    expect(input.ObjectLockRetainUntilDate).toEqual(new Date(env.retention_until_ms));
    expect(typeof input.Body).toBe('string');
    expect(JSON.parse(input.Body as string).envelope_id).toBe(env.envelope_id);

    expect(receipt.envelope_id).toBe(env.envelope_id);
    expect(receipt.sink_kind).toBe('s3-object-lock');
    expect(receipt.sink_attestation_id).toBe(
      `s3://ant-audit/${objectKeyFor(env)}?versionId=v1abc`,
    );
    expect(receipt.written_at_ms).toBe(1_780_000_010_000);
    expect(receipt.retention_class).toBe('compliance');
    expect(receipt.retention_until_ms).toBe(env.retention_until_ms);
  });

  it('respects forceRetentionMode override', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
      forceRetentionMode: 'COMPLIANCE',
    });

    // Envelope says 'operational' (which normally → GOVERNANCE), but
    // forceRetentionMode pins to COMPLIANCE.
    const env = makeEnvelope({ retention_class: 'operational' });
    await adapter.write(env);

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0].args[0].input.ObjectLockMode).toBe('COMPLIANCE');
  });

  it('returns attestation without versionId when bucket has no versioning', async () => {
    s3Mock.on(PutObjectCommand).resolves({}); // No VersionId
    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
    });

    const receipt = await adapter.write(makeEnvelope());
    expect(receipt.sink_attestation_id).not.toMatch(/versionId/);
    expect(receipt.sink_attestation_id).toMatch(/^s3:\/\/ant-audit\//);
  });

  it('throws EnvelopeMalformed on a bad envelope (no PutObject call)', async () => {
    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
    });

    const bad = { ...makeEnvelope(), envelope_version: '2.0' } as unknown as AuditEnvelope;
    await expect(adapter.write(bad)).rejects.toMatchObject({
      kind: 'EnvelopeMalformed',
      sinkKind: 's3-object-lock',
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('maps S3 5xx → SinkRetryable', async () => {
    const err = Object.assign(new Error('internal'), {
      name: 'InternalError',
      $metadata: { httpStatusCode: 503 },
    });
    s3Mock.on(PutObjectCommand).rejects(err);

    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
    });

    await expect(adapter.write(makeEnvelope())).rejects.toMatchObject({
      kind: 'SinkRetryable',
      sinkKind: 's3-object-lock',
    });
  });

  it('maps S3 4xx (AccessDenied) → SinkRejected', async () => {
    const err = Object.assign(new Error('nope'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    s3Mock.on(PutObjectCommand).rejects(err);

    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      s3Client: new S3Client({}),
    });

    await expect(adapter.write(makeEnvelope())).rejects.toMatchObject({
      kind: 'SinkRejected',
    });
  });

  it('applies keyPrefix to the object key', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const adapter = new ByWormS3ObjectLockAdapter({
      region: 'us-east-1',
      bucket: 'ant-audit',
      keyPrefix: 'prod',
      s3Client: new S3Client({}),
    });

    const env = makeEnvelope();
    await adapter.write(env);
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input.Key).toBe(
      objectKeyFor(env, 'prod'),
    );
  });
});
