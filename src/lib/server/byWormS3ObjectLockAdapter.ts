// byWormS3ObjectLockAdapter — SinkAdapter implementation for AWS S3 with
// Object Lock enabled. Used by enterprise customers whose compliance
// requirement is "audit envelopes land in WORM storage with provable
// retention". Companion impls (separate slices): SIEM destinations
// (@2ec M7.2), filesystem-WORM (planned half-step for NMVC dogfood).
//
// Spec: docs/concepts/ant-v02-byworm-sink-adapter.md
// Plan: antos-enterprise-control-plane-2026-05-27 §M1.2
// Depends on: M1.1 contract (this PR's parent, enterprisec/byworm-sink-adapter @ fb731d6)

// @aws-sdk/client-s3 is an OPTIONAL peer dependency, NOT a hard dep of ANT.
// Only customers who actually configure an S3 Object Lock sink need it. To
// keep the package install-free for everyone else (no-op + filesystem-WORM
// adapters cover the default path), we:
//   1. model the tiny slice of the SDK we touch as LOCAL STRUCTURAL types
//      (S3-like client with a `send`, command output with an etag/versionId),
//      so the module TYPE-CHECKS with zero @aws-sdk types installed; and
//   2. DYNAMICALLY import('@aws-sdk/client-s3') at the call sites, so the
//      package is loaded only when this adapter is constructed + used.
// The caller injects the real `new S3Client(...)` (see ByWormS3ObjectLockOptions
// .s3Client) — we never construct one — so dependency-injection already keeps
// the SDK out of this module's static graph; this just removes the last
// type/value coupling. JWPK 2026-06-01 consolidation: "lazy-load / S3 optional".
type S3LikeClient = { send(command: unknown): Promise<unknown> };
type PutObjectCommandOutput = { ETag?: string; VersionId?: string };
type S3Client = S3LikeClient;

import {
  type AuditEnvelope,
  type SinkAdapter,
  type SinkHealth,
  type SinkReceipt,
  SinkError,
  isAuditEnvelope,
  type RetentionClass,
} from './byWormSinkAdapter';

export type S3ObjectLockMode = 'COMPLIANCE' | 'GOVERNANCE';

export type ByWormS3ObjectLockOptions = {
  /** AWS region the bucket lives in. */
  region: string;
  /** S3 bucket name. MUST have Object Lock enabled at bucket creation. */
  bucket: string;
  /**
   * Optional key prefix. Useful when one bucket holds envelopes for
   * multiple environments (e.g. `prod/`, `staging/`). Trailing slash
   * is normalised; leading slash is stripped.
   */
  keyPrefix?: string;
  /**
   * Force every envelope into a specific Object Lock mode regardless of
   * `envelope.retention_class`. Useful when a customer requires every
   * envelope at COMPLIANCE-level (no exceptions). Default: per-envelope
   * mapping via {@link defaultRetentionModeFor}.
   */
  forceRetentionMode?: S3ObjectLockMode;
  /**
   * Injected S3 client. Tests pass a mocked client; production passes a
   * real `new S3Client({ region })`. Must be provided — we don't
   * construct one internally so caller controls credentials + retry
   * config + custom endpoints.
   */
  s3Client: S3Client;
  /** Deterministic clock for tests. */
  now?: () => number;
};

/**
 * Map an envelope's retention_class to an S3 Object Lock mode.
 *
 * - `compliance` → `COMPLIANCE` (no actor, even root, can shorten retention)
 * - `governance` → `GOVERNANCE` (admins with s3:BypassGovernanceRetention can)
 * - `operational` → `GOVERNANCE` (lighter-touch; admins can bypass)
 *
 * Customers with stricter requirements override via `forceRetentionMode`.
 */
export function defaultRetentionModeFor(retentionClass: RetentionClass): S3ObjectLockMode {
  switch (retentionClass) {
    case 'compliance':
      return 'COMPLIANCE';
    case 'governance':
      return 'GOVERNANCE';
    case 'operational':
      return 'GOVERNANCE';
  }
}

/**
 * Build the S3 object key for an envelope:
 *   `<prefix>/<tenant>/<YYYY>/<MM>/<DD>/<envelope_id>.json`
 *
 * Date-partitioned for query performance (S3 ListObjectsV2 with prefix
 * lets a compliance officer pull "all envelopes for tenant X in 2026-05"
 * cheaply). `envelope_id` is unique → idempotent re-writes hit the same
 * key + the object lock policy applies per-version, so duplicate
 * deliveries don't double-charge retention.
 *
 * The `event.at_ms` timestamp drives the date partition, NOT
 * `produced_at_ms` — this means the partitioning reflects WHEN the
 * audited event happened, not when it was envelope-wrapped, which is
 * what a regulator querying "give me 2026-Q1 audit data" expects.
 */
export function objectKeyFor(envelope: AuditEnvelope, keyPrefix?: string): string {
  const d = new Date(envelope.event.at_ms);
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');

  const prefix = normaliseKeyPrefix(keyPrefix);
  return `${prefix}${envelope.tenant_id}/${yyyy}/${mm}/${dd}/${envelope.envelope_id}.json`;
}

function normaliseKeyPrefix(prefix?: string): string {
  if (!prefix) return '';
  let p = prefix.trim();
  if (!p) return '';
  // Strip leading slashes (S3 keys never start with /)
  while (p.startsWith('/')) p = p.slice(1);
  // Ensure exactly one trailing slash
  while (p.endsWith('/')) p = p.slice(0, -1);
  return p ? `${p}/` : '';
}

// -- AWS error → SinkError mapping ---------------------------------------
//
// AWS SDK v3 surfaces errors with a `name` (string class) and a
// `$metadata.httpStatusCode` (HTTP status). We map by both because some
// errors don't have a status (e.g. network failures before the request
// reaches AWS). The dispatcher's retry policy depends on the SinkError
// kind we choose here; getting it wrong = either silent data loss
// (mapping retryable as rejected) or hot-loop retry on a permanent
// failure (mapping rejected as retryable).

type AwsErrorShape = {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
};

const NETWORK_ERROR_NAMES = new Set<string>([
  'NetworkingError',
  'ConnectTimeoutError',
  'TimeoutError',
  'EAI_AGAIN', // DNS
]);

const RETRYABLE_ERROR_NAMES = new Set<string>([
  'ThrottlingException',
  'SlowDown',
  'RequestTimeout',
  'TooManyRequestsException',
]);

export function mapAwsErrorToSinkError(err: unknown, sinkKind: string): SinkError {
  const e = err as AwsErrorShape;
  const status = e.$metadata?.httpStatusCode ?? 0;
  const name = e.name ?? '';
  const message = e.message ?? 'unknown error';

  if (RETRYABLE_ERROR_NAMES.has(name)) {
    return new SinkError('SinkRetryable', sinkKind, message, err);
  }

  if (NETWORK_ERROR_NAMES.has(name)) {
    return new SinkError('SinkUnavailable', sinkKind, message, err);
  }

  if (status >= 500) {
    return new SinkError('SinkRetryable', sinkKind, message, err);
  }

  if (status >= 400) {
    return new SinkError('SinkRejected', sinkKind, message, err);
  }

  // No status, no known name = treat as unavailable (could be a transport
  // failure before the request hit AWS).
  return new SinkError('SinkUnavailable', sinkKind, message, err);
}

// -- Adapter -------------------------------------------------------------

export class ByWormS3ObjectLockAdapter implements SinkAdapter {
  readonly kind = 's3-object-lock';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix?: string;
  private readonly forceRetentionMode?: S3ObjectLockMode;
  private readonly now: () => number;

  constructor(opts: ByWormS3ObjectLockOptions) {
    if (!opts.region) throw new Error('byWormS3ObjectLockAdapter: region is required');
    if (!opts.bucket) throw new Error('byWormS3ObjectLockAdapter: bucket is required');
    if (!opts.s3Client) throw new Error('byWormS3ObjectLockAdapter: s3Client must be provided');

    this.client = opts.s3Client;
    this.bucket = opts.bucket;
    this.keyPrefix = opts.keyPrefix;
    this.forceRetentionMode = opts.forceRetentionMode;
    this.now = opts.now ?? (() => Date.now());
  }

  async health(): Promise<SinkHealth> {
    try {
      // ts-ignore: @aws-sdk/client-s3 is an OPTIONAL peer dep, loaded at
      // runtime only when an S3 sink is configured and absent by default.
      // ignore (not expect-error) is used deliberately: with the dep
      // absent TS resolves this dynamic import to `any` rather than
      // erroring, so an expect-error directive would itself be flagged as
      // unused (TS2578). ignore stays silent either way.
      // @ts-ignore
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { healthy: true };
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'HeadBucket failed';
      return { healthy: false, detail: `${this.bucket}: ${message}` };
    }
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

    const Key = objectKeyFor(envelope, this.keyPrefix);
    const Body = JSON.stringify(envelope);
    const ObjectLockMode =
      this.forceRetentionMode ?? defaultRetentionModeFor(envelope.retention_class);
    const ObjectLockRetainUntilDate = new Date(envelope.retention_until_ms);

    let result: PutObjectCommandOutput;
    try {
      // ts-ignore: optional peer dep, see health() note above.
      // @ts-ignore
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      result = (await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key,
          Body,
          ContentType: 'application/json',
          ObjectLockMode,
          ObjectLockRetainUntilDate,
        }),
      )) as PutObjectCommandOutput;
    } catch (err) {
      throw mapAwsErrorToSinkError(err, this.kind);
    }

    const attestation = buildAttestation(this.bucket, Key, result.VersionId);

    return {
      envelope_id: envelope.envelope_id,
      sink_kind: this.kind,
      sink_attestation_id: attestation,
      written_at_ms: this.now(),
      // Retention values in the receipt mirror the envelope's request.
      // The actual sink-enforced retention could be ≥ this if the bucket
      // has a default retention longer than the envelope asked for —
      // detecting that would require a HeadObject after write, which
      // doubles the per-write latency. The dispatcher's reconciliation
      // job (M1.3) can sweep periodically to flag any drift.
      retention_class: envelope.retention_class,
      retention_until_ms: envelope.retention_until_ms,
    };
  }
}

/**
 * Build the sink_attestation_id for an S3 receipt.
 *
 * Format: `s3://<bucket>/<key>` plus optional `?versionId=<id>` when the
 * bucket has versioning enabled (most Object-Lock buckets do — versioning
 * is required for Object Lock to enforce retention per version).
 */
export function buildAttestation(bucket: string, key: string, versionId?: string): string {
  const base = `s3://${bucket}/${key}`;
  return versionId ? `${base}?versionId=${versionId}` : base;
}
