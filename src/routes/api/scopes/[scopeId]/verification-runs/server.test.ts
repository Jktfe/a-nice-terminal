/**
 * /api/scopes/[scopeId]/verification-runs endpoint tests — A9 / Slice 7a.
 *
 * Covers POST (record verdict) + GET (read effective + chain) + admin
 * bearer gate + body validation + parent-chain refusal.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, GET } from './+server';
import {
  resetVerificationVerdictsStoreForTests,
  recordVerdict
} from '$lib/server/verificationVerdictsStore';
import { createValidationSchema } from '$lib/server/validationLensStore';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_a9';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'POST' | 'GET', path: string, init?: RequestInit, params: Record<string, string> = {}): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...(init ?? {}) });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try { return (await handler(event)) as Response; }
  catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function authedPost(scopeId: string, body: unknown, token: string = TEST_ADMIN): unknown {
  return eventFor('POST', `/api/scopes/${scopeId}/verification-runs`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, { scopeId });
}

function authedGet(scopeId: string, query: string, token: string = TEST_ADMIN): unknown {
  return eventFor('GET', `/api/scopes/${scopeId}/verification-runs?${query}`, {
    headers: { authorization: `Bearer ${token}` }
  }, { scopeId });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-verification-runs-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  resetIdentityDbForTests();
  resetVerificationVerdictsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

function freshLens(id: string) {
  return createValidationSchema({
    id, name: id, description: null, lensKind: 'custom', scope: 'public',
    scopeId: 'global', rulesJson: '[]', createdBy: '@test', archivedAtMs: null
  });
}

describe('/api/scopes/[scopeId]/verification-runs POST', () => {
  it('VR1: records a passed verdict and returns 201 with the verdict row', async () => {
    const lens = freshLens('lens-vr1');
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('test-scope', {
      lens_id: lens.id, claim_anchor: 'artefact:doc-1#p1', claim_text: 'claim',
      status: 'passed', score: 95, verifier_handle: '@james', verifier_kind: 'human'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.verdict.status).toBe('passed');
    expect(body.verdict.verifierHandle).toBe('@james');
  });

  it('VR2: rejects missing admin bearer with 401', async () => {
    const event = eventFor('POST', '/api/scopes/x/verification-runs', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    }, { scopeId: 'x' });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('VR3: rejects wrong admin bearer with 403', async () => {
    const lens = freshLens('lens-vr3');
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      lens_id: lens.id, claim_anchor: 'c', claim_text: 't',
      status: 'passed', verifier_handle: '@a', verifier_kind: 'human'
    }, 'wrong-token'));
    expect(response.status).toBe(403);
  });

  it('VR4: rejects invalid status with 400', async () => {
    const lens = freshLens('lens-vr4');
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      lens_id: lens.id, claim_anchor: 'c', claim_text: 't',
      status: 'definitely-not-valid', verifier_handle: '@a', verifier_kind: 'human'
    }));
    expect(response.status).toBe(400);
  });

  it('VR5: dispute without dispute_reason returns 400 with helpful message', async () => {
    const lens = freshLens('lens-vr5');
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      lens_id: lens.id, claim_anchor: 'c', claim_text: 't',
      status: 'dispute', verifier_handle: '@a', verifier_kind: 'human'
    }));
    expect(response.status).toBe(400);
  });

  it('VR6: parent-chain link to wrong claim returns 400', async () => {
    const lens = freshLens('lens-vr6');
    const otherClaim = recordVerdict({
      lensId: lens.id, claimAnchor: 'other', claimText: 't',
      status: 'passed', verifierHandle: '@a', verifierKind: 'agent'
    });
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      lens_id: lens.id, claim_anchor: 'this-claim', claim_text: 't',
      status: 'passed', verifier_handle: '@a', verifier_kind: 'agent',
      parent_observation_id: otherClaim.id
    }));
    expect(response.status).toBe(400);
  });

  it('VR7: records dispute with reason successfully', async () => {
    const lens = freshLens('lens-vr7');
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      lens_id: lens.id, claim_anchor: 'c', claim_text: 't',
      status: 'dispute', dispute_reason: 'sources conflict',
      verifier_handle: '@a', verifier_kind: 'human'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.verdict.disputeReason).toBe('sources conflict');
  });
});

describe('/api/scopes/[scopeId]/verification-runs GET', () => {
  it('VR8: returns null effective + empty chain when no observations exist', async () => {
    const lens = freshLens('lens-vr8');
    const response = await runHandler(GET as unknown as AnyHandler,
      authedGet('x', `lens=${lens.id}&claim=nonexistent`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.effective).toBeNull();
    expect(body.chain).toEqual([]);
  });

  it('VR9: returns latest verdict as effective + full chain newest-first', async () => {
    const lens = freshLens('lens-vr9');
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c', claimText: 't',
      status: 'failed', verifierHandle: '@x', verifierKind: 'agent'
    });
    recordVerdict({
      lensId: lens.id, claimAnchor: 'c', claimText: 't',
      status: 'passed', verifierHandle: '@y', verifierKind: 'human'
    });
    const response = await runHandler(GET as unknown as AnyHandler,
      authedGet('x', `lens=${lens.id}&claim=c`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.effective.status).toBe('passed');
    expect(body.chain).toHaveLength(2);
    expect(body.chain[0].status).toBe('passed');
  });

  it('VR10: missing lens or claim query param returns 400', async () => {
    const response = await runHandler(GET as unknown as AnyHandler, authedGet('x', 'lens=foo'));
    expect(response.status).toBe(400);
  });
});
