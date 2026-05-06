// M3 #2 — Consent-Gated Ask Fan-Out: pure helper test.
// Exercises consentGateAsk with fake query objects — no real DB needed.
// Mirrors the DI shape from grant-scope.test.ts and start-interview.test.ts.

import { describe, expect, it } from 'vitest';
import {
  consentGateAsk,
  inferTopicFromAsk,
  normalizeGrantee,
  type AskRow,
  type AskQueries,
  type ConsentGateQueries,
} from '../src/lib/server/consent/consent-gate-ask.js';
import {
  buildConsentGrant,
  type ConsentGrant,
} from '../src/lib/server/consent/grant-scope.js';

// ── Fake query stores ────────────────────────────────────────────────

function makeFakes(seedGrants?: ConsentGrant[]): {
  cq: ConsentGateQueries;
  aq: AskQueries;
  grantStore: Map<string, ConsentGrant>;
  askUpdates: Array<{ id: string; status: string | null; answer: string | null; answerAction: string | null }>;
} {
  const grantStore = new Map<string, ConsentGrant>(
    (seedGrants ?? []).map((g) => [g.id, { ...g }]),
  );
  const askUpdates: Array<{ id: string; status: string | null; answer: string | null; answerAction: string | null }> = [];

  const cq: ConsentGateQueries = {
    getConsentGrant: (id: string) => grantStore.get(id) ?? null,
    updateConsentGrant: (id, status, answerCount, expiresAtMs) => {
      const existing = grantStore.get(id);
      if (existing) {
        grantStore.set(id, { ...existing, status: status as any, answer_count: answerCount, expires_at_ms: expiresAtMs });
      }
    },
    listConsentGrantsByGrantee: (grantedTo: string) =>
      [...grantStore.values()].filter((g) => g.granted_to === grantedTo),
  };

  const aq: AskQueries = {
    updateAsk: (id, status, _assignedTo, _ownerKind, _priority, answer, answerAction, _answeredBy, _meta) => {
      askUpdates.push({ id, status, answer, answerAction });
    },
  };

  return { cq, aq, grantStore, askUpdates };
}

// ── inferTopicFromAsk ───────────────────────────────────────────────

describe('inferTopicFromAsk', () => {
  it('infers file-read for file viewing asks', () => {
    expect(inferTopicFromAsk({ assigned_to: '@a', id: '1', session_id: 's', status: 'open', inferred: 1, meta: '{}', title: 'Should I read server.ts?', body: 'Read src/server.ts and check the config' })).toBe('file-read');
  });

  it('infers file-write for file editing asks', () => {
    expect(inferTopicFromAsk({ assigned_to: '@a', id: '1', session_id: 's', status: 'open', inferred: 1, meta: '{}', title: 'Edit config?', body: 'Modify config.yaml to add the new setting' })).toBe('file-write');
  });

  it('infers command-exec for execution asks', () => {
    expect(inferTopicFromAsk({ assigned_to: '@a', id: '1', session_id: 's', status: 'open', inferred: 1, meta: '{}', title: 'Run the build?', body: 'Execute the command npm run build' })).toBe('command-exec');
  });

  it('infers web-fetch for URL asks', () => {
    expect(inferTopicFromAsk({ assigned_to: '@a', id: '1', session_id: 's', status: 'open', inferred: 1, meta: '{}', title: 'Fetch docs?', body: 'Should I fetch https://example.com/docs?' })).toBe('web-fetch');
  });

  it('defaults to memory-read for generic asks', () => {
    expect(inferTopicFromAsk({ assigned_to: '@a', id: '1', session_id: 's', status: 'open', inferred: 1, meta: '{}', title: 'Continue?', body: 'Shall I proceed with the plan?' })).toBe('memory-read');
  });
});

// ── normalizeGrantee ─────────────────────────────────────────────────

describe('normalizeGrantee', () => {
  it('passes through @-prefixed handles', () => {
    expect(normalizeGrantee('@codex')).toBe('@codex');
  });

  it('prefixes bare names with @', () => {
    expect(normalizeGrantee('codex')).toBe('@codex');
  });
});

// ── consentGateAsk ────────────────────────────────────────────────────

describe('consentGateAsk', () => {
  it('returns no_grant when no consent grants exist for the grantee', () => {
    const { cq, aq } = makeFakes();
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}' };
    const result = consentGateAsk(cq, aq, ask);
    expect(result).toEqual({ action: 'no_grant' });
  });

  it('auto-answers an inferred ask when an active matching grant exists', () => {
    const grant = buildConsentGrant({
      id: 'g-1',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'file-read',
      duration: '1h',
      maxAnswers: 5,
      nowMs: 1000,
    });
    const { cq, aq, grantStore, askUpdates } = makeFakes([grant]);
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}', title: 'Read db.ts?', body: 'Should I read src/db.ts?' };

    const result = consentGateAsk(cq, aq, ask, { nowMs: 2000 });

    expect(result.action).toBe('auto_answered');
    if (result.action !== 'auto_answered') return;
    expect(result.grantId).toBe('g-1');
    expect(result.grantTopic).toBe('file-read');
    expect(result.remainingAnswers).toBe(4);

    // Grant should be bumped
    expect(grantStore.get('g-1')?.answer_count).toBe(1);

    // Ask should be updated to answered
    expect(askUpdates).toHaveLength(1);
    expect(askUpdates[0].status).toBe('answered');
    expect(askUpdates[0].answerAction).toBe('approve');
  });

  it('dismisses an inferred ask when the grant is revoked', () => {
    const grant = buildConsentGrant({
      id: 'g-1',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'memory-read',
      duration: '1h',
      nowMs: 1000,
    });
    // Revoke it
    grant.status = 'revoked';
    const { cq, aq, askUpdates } = makeFakes([grant]);
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}' };

    const result = consentGateAsk(cq, aq, ask, { nowMs: 2000 });

    expect(result.action).toBe('dismissed');
    if (result.action !== 'dismissed') return;
    expect(result.reason).toBe('revoked');
    expect(askUpdates[0]?.status).toBe('dismissed');
  });

  it('dismisses an inferred ask when the grant is expired', () => {
    const grant = buildConsentGrant({
      id: 'g-1',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'memory-read',
      duration: '1m',
      nowMs: 0,
    });
    const { cq, aq, askUpdates } = makeFakes([grant]);
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}' };

    // nowMs past the 1-minute expiry
    const result = consentGateAsk(cq, aq, ask, { nowMs: 120_000 });

    expect(result.action).toBe('dismissed');
    if (result.action !== 'dismissed') return;
    expect(result.reason).toBe('expired');
    expect(askUpdates[0]?.status).toBe('dismissed');
  });

  it('dismisses an inferred ask when the grant is exhausted', () => {
    const grant = buildConsentGrant({
      id: 'g-1',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'memory-read',
      duration: '1h',
      maxAnswers: 1,
      nowMs: 1000,
    });
    grant.answer_count = 1; // already used up
    const { cq, aq, askUpdates } = makeFakes([grant]);
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}' };

    const result = consentGateAsk(cq, aq, ask, { nowMs: 2000 });

    expect(result.action).toBe('dismissed');
    if (result.action !== 'dismissed') return;
    expect(result.reason).toBe('exhausted');
    expect(askUpdates[0]?.status).toBe('dismissed');
  });

  it('prefers exact topic match over generic fallback', () => {
    const fileReadGrant = buildConsentGrant({
      id: 'g-specific',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'file-read',
      duration: '1h',
      maxAnswers: 5,
      nowMs: 1000,
    });
    const genericGrant = buildConsentGrant({
      id: 'g-generic',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'memory-read',
      duration: '1h',
      maxAnswers: 10,
      nowMs: 1000,
    });
    const { cq } = makeFakes([genericGrant, fileReadGrant]);
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Should I read src/config.ts?' };

    const result = consentGateAsk(cq, { updateAsk: () => {} }, ask, { nowMs: 2000 });

    expect(result.action).toBe('auto_answered');
    if (result.action !== 'auto_answered') return;
    expect(result.grantId).toBe('g-specific');
    expect(result.grantTopic).toBe('file-read');
  });

  it('falls back to any active grant when no topic match', () => {
    const webGrant = buildConsentGrant({
      id: 'g-web',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'web-fetch',
      duration: '1h',
      maxAnswers: 5,
      nowMs: 1000,
    });
    const { cq } = makeFakes([webGrant]);
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: '@codex', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Should I read src/config.ts?' };

    const result = consentGateAsk(cq, { updateAsk: () => {} }, ask, { nowMs: 2000 });

    // No topic match (file-read vs web-fetch) but there's an active grant
    expect(result.action).toBe('auto_answered');
    if (result.action !== 'auto_answered') return;
    expect(result.grantId).toBe('g-web');
  });

  it('handles bare-name assigned_to (no @ prefix)', () => {
    const grant = buildConsentGrant({
      id: 'g-1',
      sessionId: 's-1',
      grantedTo: '@codex',
      topic: 'memory-read',
      duration: '1h',
      nowMs: 1000,
    });
    const { cq } = makeFakes([grant]);
    // assigned_to without @ prefix
    const ask: AskRow = { id: 'a-1', session_id: 's-1', assigned_to: 'codex', status: 'open', inferred: 1, meta: '{}' };

    const result = consentGateAsk(cq, { updateAsk: () => {} }, ask, { nowMs: 2000 });
    expect(result.action).toBe('auto_answered');
  });
});

// ── Round-trip: build grant → create ask → gate → verify ────────────

describe('consent-gate round-trip', () => {
  it('full flow: grant created, multiple asks gated, grant exhausts', () => {
    const grant = buildConsentGrant({
      id: 'g-rt',
      sessionId: 'room-1',
      grantedTo: '@agent',
      topic: 'file-read',
      duration: '1h',
      maxAnswers: 2,
      nowMs: 0,
    });
    const { cq, aq, grantStore } = makeFakes([grant]);

    // Ask 1: should be auto-answered
    const ask1: AskRow = { id: 'a-1', session_id: 'room-1', assigned_to: '@agent', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Read src/db.ts?' };
    const r1 = consentGateAsk(cq, aq, ask1, { nowMs: 1000 });
    expect(r1.action).toBe('auto_answered');
    if (r1.action === 'auto_answered') expect(r1.remainingAnswers).toBe(1);
    expect(grantStore.get('g-rt')?.answer_count).toBe(1);

    // Ask 2: should be auto-answered (last one)
    const ask2: AskRow = { id: 'a-2', session_id: 'room-1', assigned_to: '@agent', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Read src/server.ts?' };
    const r2 = consentGateAsk(cq, aq, ask2, { nowMs: 1000 });
    expect(r2.action).toBe('auto_answered');
    if (r2.action === 'auto_answered') expect(r2.remainingAnswers).toBe(0);
    expect(grantStore.get('g-rt')?.answer_count).toBe(2);

    // Ask 3: should be dismissed (exhausted)
    const ask3: AskRow = { id: 'a-3', session_id: 'room-1', assigned_to: '@agent', status: 'open', inferred: 1, meta: '{}', title: 'Read?', body: 'Read src/config.ts?' };
    const r3 = consentGateAsk(cq, aq, ask3, { nowMs: 1000 });
    expect(r3.action).toBe('dismissed');
    if (r3.action === 'dismissed') expect(r3.reason).toBe('exhausted');
  });
});
