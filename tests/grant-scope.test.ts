// M3 #2 — Scope-of-Grant Consent: pure helper round-trip test.
// Mirrors the DI shape from start-interview and interrupt-intent tests;
// no real DB needed. Exercises buildConsentGrant + resolveConsentGrant
// including expiry, exhaustion, revocation, and bump semantics.

import { describe, expect, it } from 'vitest';
import {
  buildConsentGrant,
  resolveConsentGrant,
  type ConsentGrant,
  type ConsentGrantQueries,
} from '../src/lib/server/consent/grant-scope.js';

// ── Fake query store ─────────────────────────────────────────────────

function makeFakeQueries(seed?: ConsentGrant[]): {
  q: ConsentGrantQueries;
  store: Map<string, ConsentGrant>;
} {
  const store = new Map<string, ConsentGrant>(
    (seed ?? []).map((g) => [g.id, { ...g }]),
  );
  return {
    store,
    q: {
      getConsentGrant: (id: string) => store.get(id) ?? null,
      updateConsentGrant: (id, status, answerCount, expiresAtMs) => {
        const existing = store.get(id);
        if (existing) {
          store.set(id, { ...existing, status, answer_count: answerCount, expires_at_ms: expiresAtMs });
        }
      },
    },
  };
}

// ── buildConsentGrant ────────────────────────────────────────────────

describe('buildConsentGrant', () => {
  it('builds a complete grant with all fields populated', () => {
    const g = buildConsentGrant({
      id: 'g-1',
      sessionId: 's-james',
      grantedTo: '@claude',
      topic: 'file-read',
      sourceSet: ['/src/db.ts', '/src/server.ts'],
      duration: '1h',
      maxAnswers: 10,
      meta: { origin: 'interview' },
      nowMs: 1_700_000_000_000,
    });

    expect(g.id).toBe('g-1');
    expect(g.session_id).toBe('s-james');
    expect(g.granted_to).toBe('@claude');
    expect(g.topic).toBe('file-read');
    expect(g.source_set).toEqual(['/src/db.ts', '/src/server.ts']);
    expect(g.duration).toBe('1h');
    expect(g.answer_count).toBe(0);
    expect(g.max_answers).toBe(10);
    expect(g.status).toBe('active');
    expect(g.granted_at_ms).toBe(1_700_000_000_000);
    expect(g.expires_at_ms).toBe(1_700_000_000_000 + 3_600_000);
    expect(g.meta).toBe('{"origin":"interview"}');
  });

  it('defaults sourceSet to empty array', () => {
    const g = buildConsentGrant({ id: 'g-2', sessionId: 's-1', grantedTo: '@codex', topic: 'web-fetch' });
    expect(g.source_set).toEqual([]);
  });

  it('defaults duration to 1h', () => {
    const g = buildConsentGrant({ id: 'g-3', sessionId: 's-1', grantedTo: '@codex', topic: 'web-fetch' });
    expect(g.duration).toBe('1h');
    expect(g.expires_at_ms).not.toBeNull();
  });

  it('sets expires_at_ms to null for "forever" duration', () => {
    const g = buildConsentGrant({ id: 'g-4', sessionId: 's-1', grantedTo: '@codex', topic: 'memory-read', duration: 'forever' });
    expect(g.expires_at_ms).toBeNull();
  });

  it('defaults max_answers to null (unlimited)', () => {
    const g = buildConsentGrant({ id: 'g-5', sessionId: 's-1', grantedTo: '@codex', topic: 'command-exec' });
    expect(g.max_answers).toBeNull();
  });

  it('defaults meta to "{}"', () => {
    const g = buildConsentGrant({ id: 'g-6', sessionId: 's-1', grantedTo: '@codex', topic: 'file-write' });
    expect(g.meta).toBe('{}');
  });

  it('supports ad-hoc duration patterns like 30m, 4h, 10d', () => {
    const g30m = buildConsentGrant({ id: 'g-7', sessionId: 's-1', grantedTo: '@a', topic: 't', duration: '30m', nowMs: 0 });
    expect(g30m.expires_at_ms).toBe(30 * 60_000);

    const g4h = buildConsentGrant({ id: 'g-8', sessionId: 's-1', grantedTo: '@a', topic: 't', duration: '4h', nowMs: 0 });
    expect(g4h.expires_at_ms).toBe(4 * 60 * 60_000);

    const g10d = buildConsentGrant({ id: 'g-9', sessionId: 's-1', grantedTo: '@a', topic: 't', duration: '10d', nowMs: 0 });
    expect(g10d.expires_at_ms).toBe(10 * 24 * 60 * 60_000);
  });

  it('throws on empty id', () => {
    expect(() => buildConsentGrant({ id: '', sessionId: 's', grantedTo: '@a', topic: 't' })).toThrow('id is required');
  });

  it('throws on empty sessionId', () => {
    expect(() => buildConsentGrant({ id: 'g', sessionId: '', grantedTo: '@a', topic: 't' })).toThrow('sessionId is required');
  });

  it('throws on empty grantedTo', () => {
    expect(() => buildConsentGrant({ id: 'g', sessionId: 's', grantedTo: '', topic: 't' })).toThrow('grantedTo is required');
  });

  it('throws on empty topic', () => {
    expect(() => buildConsentGrant({ id: 'g', sessionId: 's', grantedTo: '@a', topic: '' })).toThrow('topic is required');
  });

  it('throws on unknown duration string', () => {
    expect(() => buildConsentGrant({ id: 'g', sessionId: 's', grantedTo: '@a', topic: 't', duration: 'bad' as any })).toThrow('Unknown duration');
  });
});

// ── resolveConsentGrant ──────────────────────────────────────────────

describe('resolveConsentGrant', () => {
  const baseGrant = buildConsentGrant({
    id: 'g-active',
    sessionId: 's-1',
    grantedTo: '@claude',
    topic: 'file-read',
    sourceSet: ['/src/db.ts'],
    duration: '1h',
    maxAnswers: 5,
    nowMs: 1_000_000,
  });

  it('resolves an active grant as valid', () => {
    const { q, store } = makeFakeQueries([baseGrant]);
    const result = resolveConsentGrant(q, 'g-active', { nowMs: 1_500_000 });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.grant.topic).toBe('file-read');
    expect(result.remainingAnswers).toBe(5);
  });

  it('returns not_found for a missing grant', () => {
    const { q } = makeFakeQueries([]);
    const result = resolveConsentGrant(q, 'missing');
    expect(result).toEqual({ valid: false, reason: 'not_found' });
  });

  it('returns revoked for a revoked grant', () => {
    const revoked = { ...baseGrant, status: 'revoked' as const };
    const { q } = makeFakeQueries([revoked]);
    const result = resolveConsentGrant(q, 'g-active');
    expect(result).toEqual({ valid: false, reason: 'revoked' });
  });

  it('returns expired when now >= expires_at_ms', () => {
    const { q } = makeFakeQueries([baseGrant]);
    // baseGrant expires_at_ms = 1_000_000 + 3_600_000 = 4_600_000
    const result = resolveConsentGrant(q, 'g-active', { nowMs: 4_600_001 });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('returns exhausted when answer_count >= max_answers', () => {
    const exhausted = { ...baseGrant, answer_count: 5 };
    const { q } = makeFakeQueries([exhausted]);
    const result = resolveConsentGrant(q, 'g-active', { nowMs: 1_500_000 });
    expect(result).toEqual({ valid: false, reason: 'exhausted' });
  });

  it('bumps answer_count when bump=true', () => {
    const { q, store } = makeFakeQueries([baseGrant]);
    const result = resolveConsentGrant(q, 'g-active', { bump: true, nowMs: 1_500_000 });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.grant.answer_count).toBe(1);
    expect(result.remainingAnswers).toBe(4);
    // Also verify the store was updated via the query interface
    expect(store.get('g-active')?.answer_count).toBe(1);
  });

  it('does not bump answer_count when bump=false (default)', () => {
    const { q, store } = makeFakeQueries([baseGrant]);
    const result = resolveConsentGrant(q, 'g-active', { nowMs: 1_500_000 });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.grant.answer_count).toBe(0);
    expect(store.get('g-active')?.answer_count).toBe(0);
  });

  it('returns remainingAnswers as null for unlimited grants', () => {
    const unlimited = buildConsentGrant({
      id: 'g-unlimited',
      sessionId: 's-1',
      grantedTo: '@claude',
      topic: 'file-read',
      duration: 'forever',
      maxAnswers: null,
      nowMs: 0,
    });
    const { q } = makeFakeQueries([unlimited]);
    const result = resolveConsentGrant(q, 'g-unlimited', { bump: true, nowMs: 999_999 });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.remainingAnswers).toBeNull();
    expect(result.grant.answer_count).toBe(1);
  });

  it('never-expiry grants pass even at far-future nowMs', () => {
    const forever = buildConsentGrant({
      id: 'g-forever',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'memory-read',
      duration: 'forever',
      nowMs: 0,
    });
    const { q } = makeFakeQueries([forever]);
    const result = resolveConsentGrant(q, 'g-forever', { nowMs: Number.MAX_SAFE_INTEGER });
    expect(result.valid).toBe(true);
  });
});

// ── Round-trip: build → resolve → bump → exhaust ─────────────────────

describe('grant-with-scope round-trip', () => {
  it('full lifecycle: build, check, use until exhausted', () => {
    // Build a grant with 3 max answers
    const grant = buildConsentGrant({
      id: 'g-rt',
      sessionId: 's-session',
      grantedTo: '@agent',
      topic: 'file-write',
      sourceSet: ['/tmp/a.ts', '/tmp/b.ts'],
      duration: '15m',
      maxAnswers: 3,
      nowMs: 100,
    });

    const { q, store } = makeFakeQueries([grant]);
    const nowMs = 200; // well within 15m

    // 1st use
    const r1 = resolveConsentGrant(q, 'g-rt', { bump: true, nowMs });
    expect(r1.valid).toBe(true);
    if (r1.valid) expect(r1.remainingAnswers).toBe(2);

    // 2nd use
    const r2 = resolveConsentGrant(q, 'g-rt', { bump: true, nowMs });
    expect(r2.valid).toBe(true);
    if (r2.valid) expect(r2.remainingAnswers).toBe(1);

    // 3rd use
    const r3 = resolveConsentGrant(q, 'g-rt', { bump: true, nowMs });
    expect(r3.valid).toBe(true);
    if (r3.valid) expect(r3.remainingAnswers).toBe(0);

    // 4th use — exhausted
    const r4 = resolveConsentGrant(q, 'g-rt', { bump: true, nowMs });
    expect(r4).toEqual({ valid: false, reason: 'exhausted' });

    // Store should show answer_count = 3
    expect(store.get('g-rt')?.answer_count).toBe(3);
  });

  it('build → check without bump → answer_count stays 0', () => {
    const grant = buildConsentGrant({
      id: 'g-peek',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'web-fetch',
      maxAnswers: 1,
      nowMs: 0,
    });
    const { q, store } = makeFakeQueries([grant]);

    // Peek without consuming
    const r = resolveConsentGrant(q, 'g-peek', { nowMs: 500 });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.remainingAnswers).toBe(1);
    expect(store.get('g-peek')?.answer_count).toBe(0);

    // Now actually consume
    const r2 = resolveConsentGrant(q, 'g-peek', { bump: true, nowMs: 500 });
    expect(r2.valid).toBe(true);

    // Next use is exhausted
    const r3 = resolveConsentGrant(q, 'g-peek', { nowMs: 500 });
    expect(r3).toEqual({ valid: false, reason: 'exhausted' });
  });

  it('grant with source_set round-trips through build + resolve', () => {
    const grant = buildConsentGrant({
      id: 'g-src',
      sessionId: 's-1',
      grantedTo: '@claude',
      topic: 'file-read',
      sourceSet: ['a.ts', 'b.ts', 'c.ts'],
      duration: '5m',
      nowMs: 0,
    });
    expect(grant.source_set).toEqual(['a.ts', 'b.ts', 'c.ts']);

    const { q } = makeFakeQueries([grant]);
    const r = resolveConsentGrant(q, 'g-src', { nowMs: 100_000 });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.grant.source_set).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
