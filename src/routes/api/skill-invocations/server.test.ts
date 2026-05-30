import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';

const featureGateState = vi.hoisted(() => ({ verificationAuthorEnabled: true }));

vi.mock('$lib/server/featureGates', () => ({
  CURRENT_TIER: 'native',
  getFeatureFlagsForTier: () => ({
    verification_api: true,
    verification_ux: true,
    verification_author: featureGateState.verificationAuthorEnabled
  }),
  requireVerificationAuthorTier: () => {
    if (!featureGateState.verificationAuthorEnabled) {
      throw error(403, 'Verification authoring requires premium tier.');
    }
  }
}));

import { POST, GET } from './+server';
import { resetSkillInvocationsStoreForTests } from '$lib/server/skillInvocationsStore';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { createValidationSchema } from '$lib/server/validationLensStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'rba_test_skill_invocations';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: string, path: string, init: RequestInit = {}): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
  return { request, params: {}, url };
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

function authedPost(body: unknown, token = TEST_ADMIN): unknown {
  return eventFor('POST', '/api/skill-invocations', {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-skill-inv-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  featureGateState.verificationAuthorEnabled = true;
  resetIdentityDbForTests();
  resetSkillInvocationsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminBearer;
});

const SAMPLE_BODY = {
  skill_id: 'create-verification-lens',
  invoker_handle: '@compliance',
  invoker_kind: 'human',
  scope_id: 'acme',
  requirements: 'We publish quarterly investor letters and need to verify factual claims.',
  input_json: JSON.stringify({ scope_id: 'acme' }),
  output_json: JSON.stringify({ kind: 'lens', lens: { name: 'Q-letter' } })
};

describe('POST /api/skill-invocations', () => {
  it('SI1: records an invocation, returns 201 with the row', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost(SAMPLE_BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.invocation.id).toMatch(/^skinv-/);
    expect(body.invocation.skillId).toBe('create-verification-lens');
    expect(body.invocation.invokerHandle).toBe('@compliance');
  });

  it('SI2: rejects missing admin bearer with 401', async () => {
    const event = eventFor('POST', '/api/skill-invocations', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BODY)
    });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('SI3: rejects invalid invoker_kind with 400', async () => {
    const response = await runHandler(POST as unknown as AnyHandler,
      authedPost({ ...SAMPLE_BODY, invoker_kind: 'bogus' }));
    expect(response.status).toBe(400);
  });

  it('SI4: records refusal (output_lens_id null, error_kind set)', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      ...SAMPLE_BODY,
      output_json: JSON.stringify({ kind: 'refusal', error_kind: 'out_of_substrate_scope' }),
      error_kind: 'out_of_substrate_scope'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.invocation.outputLensId).toBeNull();
    expect(body.invocation.errorKind).toBe('out_of_substrate_scope');
  });

  it('SI4b: blocks OSS tier with 403 even when admin-bearer is valid (F2 author gate)', async () => {
    featureGateState.verificationAuthorEnabled = false;
    const response = await runHandler(POST as unknown as AnyHandler, authedPost(SAMPLE_BODY));
    expect(response.status).toBe(403);
  });

  it('SI5: records success with output_lens_id when lens exists (FK constraint)', async () => {
    // Create the lens first so FK resolves
    createValidationSchema({
      id: 'lens-q-letter', name: 'Q-letter', description: null,
      lensKind: 'custom', scope: 'public', scopeId: 'global',
      rulesJson: '[]', createdBy: '@test', archivedAtMs: null
    });
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      ...SAMPLE_BODY,
      output_lens_id: 'lens-q-letter',
      model_used: 'claude-sonnet-4-6',
      cost_estimate_usd: 0.012
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.invocation.outputLensId).toBe('lens-q-letter');
    expect(body.invocation.modelUsed).toBe('claude-sonnet-4-6');
    expect(body.invocation.costEstimateUsd).toBe(0.012);
  });
});

describe('GET /api/skill-invocations', () => {
  it('SI6: lists invocations with no filter, newest-first, open read', async () => {
    await runHandler(POST as unknown as AnyHandler, authedPost(SAMPLE_BODY));
    await runHandler(POST as unknown as AnyHandler, authedPost({ ...SAMPLE_BODY, invoker_handle: '@other' }));
    // Open read — no auth header
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor('GET', '/api/skill-invocations'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invocations).toHaveLength(2);
  });

  it('SI7: filters by scope', async () => {
    await runHandler(POST as unknown as AnyHandler, authedPost({ ...SAMPLE_BODY, scope_id: 'acme' }));
    await runHandler(POST as unknown as AnyHandler, authedPost({ ...SAMPLE_BODY, scope_id: 'other' }));
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor('GET', '/api/skill-invocations?scope=acme'));
    const body = await response.json();
    expect(body.invocations).toHaveLength(1);
    expect(body.invocations[0].scopeId).toBe('acme');
  });
});
