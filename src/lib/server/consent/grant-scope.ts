// M3 #2 — Scope-of-Grant Consent
//
// A consent grant records what a user has agreed to let an agent (or other
// participant) do. The "scope" is expressed as a topic string plus an
// optional set of sources the grant covers (files, URLs, etc.), a duration
// after which the grant expires, and an answer_count that tracks how many
// times the grant has been exercised.
//
// This module owns:
//   1. The TypeScript types for a ConsentGrant row.
//   2. A pure helper `buildConsentGrant()` that validates input and returns a
//      strongly-typed object ready for DB insertion — no DB imports, fully
//      testable with a fake queries object.
//   3. A `resolveConsentGrant()` helper that checks whether a grant is still
//      valid (not expired, not fully consumed) and optionally bumps the
//      answer_count.

export const CONSENT_GRANT_VERSION = 1 as const;

// ── Types ────────────────────────────────────────────────────────────

export type GrantTopic =
  | 'file-read'
  | 'file-write'
  | 'web-fetch'
  | 'command-exec'
  | 'memory-read'
  | 'memory-write'
  | string; // open-ended for future topics

export type GrantStatus = 'active' | 'revoked' | 'expired';

export interface ConsentGrant {
  id: string;
  session_id: string;
  granted_to: string;       // handle or session id of the grantee
  topic: GrantTopic;
  source_set: string[];     // file paths, URLs, or other identifiers
  duration: string;          // e.g. '5m', '2h', 'forever'
  answer_count: number;      // how many times the grant has been used
  max_answers: number | null; // null = unlimited
  status: GrantStatus;
  granted_at_ms: number;
  expires_at_ms: number | null; // null = no expiry
  meta: string;              // JSON blob for extensible data
}

export interface ConsentGrantInput {
  id: string;
  sessionId: string;
  grantedTo: string;
  topic: GrantTopic;
  sourceSet?: string[];
  duration?: string;
  maxAnswers?: number | null;
  meta?: Record<string, unknown>;
  nowMs?: number;
}

export interface ResolveResult {
  valid: true;
  grant: ConsentGrant;
  remainingAnswers: number | null;
}

export interface ResolveDenied {
  valid: false;
  reason: 'not_found' | 'revoked' | 'expired' | 'exhausted';
}

export type ResolveConsentResult = ResolveResult | ResolveDenied;

// ── DI Queries interface ─────────────────────────────────────────────

export interface ConsentGrantQueries {
  getConsentGrant: (id: string) => ConsentGrant | null;
  updateConsentGrant: (
    id: string,
    status: string,
    answerCount: number,
    expiresAtMs: number | null,
  ) => void;
}

// ── Duration parsing ─────────────────────────────────────────────────

const DURATION_MS: Record<string, number> = {
  '1m':  60_000,
  '5m':  5 * 60_000,
  '15m': 15 * 60_000,
  '1h':  60 * 60_000,
  '2h':  2 * 60 * 60_000,
  '6h':  6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d':  7 * 24 * 60 * 60_000,
  'forever': Infinity,
};

function parseDuration(duration: string): number {
  if (duration in DURATION_MS) return DURATION_MS[duration];
  // Support ad-hoc patterns like '30m', '4h', '10d'
  const match = duration.match(/^(\d+)([mhd])$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 'm': return n * 60_000;
      case 'h': return n * 60 * 60_000;
      case 'd': return n * 24 * 60 * 60_000;
    }
  }
  throw new Error(`Unknown duration: "${duration}"`);
}

// ── Build helper ─────────────────────────────────────────────────────

export function buildConsentGrant(input: ConsentGrantInput): ConsentGrant {
  const now = input.nowMs ?? Date.now();
  const duration = input.duration ?? '1h';
  const durationMs = parseDuration(duration);
  const expiresAtMs = durationMs === Infinity ? null : now + durationMs;

  if (!input.id || input.id.length === 0) {
    throw new Error('id is required');
  }
  if (!input.sessionId || input.sessionId.length === 0) {
    throw new Error('sessionId is required');
  }
  if (!input.grantedTo || input.grantedTo.length === 0) {
    throw new Error('grantedTo is required');
  }
  if (!input.topic || input.topic.length === 0) {
    throw new Error('topic is required');
  }

  return {
    id: input.id,
    session_id: input.sessionId,
    granted_to: input.grantedTo,
    topic: input.topic,
    source_set: input.sourceSet ?? [],
    duration: duration,
    answer_count: 0,
    max_answers: input.maxAnswers ?? null,
    status: 'active',
    granted_at_ms: now,
    expires_at_ms: expiresAtMs,
    meta: JSON.stringify(input.meta ?? {}),
  };
}

// ── Resolve helper ──────────────────────────────────────────────────

export function resolveConsentGrant(
  q: ConsentGrantQueries,
  grantId: string,
  opts: { bump?: boolean; nowMs?: number } = {},
): ResolveConsentResult {
  const row = q.getConsentGrant(grantId);

  if (!row) return { valid: false, reason: 'not_found' };
  if (row.status === 'revoked') return { valid: false, reason: 'revoked' };

  const now = opts.nowMs ?? Date.now();

  if (row.expires_at_ms !== null && now >= row.expires_at_ms) {
    return { valid: false, reason: 'expired' };
  }

  if (row.max_answers !== null && row.answer_count >= row.max_answers) {
    return { valid: false, reason: 'exhausted' };
  }

  const nextCount = row.answer_count + 1;
  const remaining =
    row.max_answers === null ? null : row.max_answers - nextCount;

  if (opts.bump) {
    q.updateConsentGrant(grantId, row.status, nextCount, row.expires_at_ms);
  }

  return {
    valid: true,
    grant: {
      ...row,
      answer_count: opts.bump ? nextCount : row.answer_count,
    },
    remainingAnswers: opts.bump ? remaining : (row.max_answers === null ? null : row.max_answers - row.answer_count),
  };
}
