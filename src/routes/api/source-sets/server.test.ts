/**
 * /api/source-sets endpoint tests — M5.1 slice 1: source-set governance CRUD.
 *
 * Covers POST (create) admin-bearer + org-admin paths + 401/403/400; GET
 * (list) with visibility scoping per caller kind; GET single by id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';

const featureGateState = vi.hoisted(() => ({ verificationAuthorEnabled: true }));
const policyActorState = vi.hoisted(() => ({
  current: null as { handle: string; kind: 'human' | 'agent' | 'system' } | null
}));

vi.mock('$lib/server/featureGates', () => ({
  CURRENT_TIER: 'native',
  requireVerificationAuthorTier: () => {
    if (!featureGateState.verificationAuthorEnabled) {
      throw error(403, 'Verification authoring requires premium tier.');
    }
  }
}));

vi.mock('$lib/server/policyActor', () => ({
  resolvePolicyActor: () => policyActorState.current
}));

import { POST as createSet, GET as listSets } from './+server';
import { GET as readSet } from './[setId]/+server';
import { resetSourceSetsStoreForTests } from '$lib/server/sourceSetsStore';
import { createOrg, assignOrgAdmin, resetOrgsStoreForTests } from '$lib/server/orgsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const TEST_ADMIN = 'rba_test_token_for_source_sets';
const TEST_ORG_ID = 'nmvc';

let tmpDir: string;
const previousFreshDb = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: string,
  path: string,
  init: RequestInit = {},
  params: Record<string, string> = {}
): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

function adminPost(path: string, body: unknown): unknown {
  return eventFor('POST', path, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_ADMIN}` },
    body: JSON.stringify(body)
  });
}

function identityPost(path: string, body: unknown): unknown {
  return eventFor('POST', path, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function anonGet(path: string, params: Record<string, string> = {}): unknown {
  return eventFor('GET', path, {}, params);
}

function adminGet(path: string, params: Record<string, string> = {}): unknown {
  return eventFor(
    'GET',
    path,
    { headers: { authorization: `Bearer ${TEST_ADMIN}` } },
    params
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-source-sets-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  featureGateState.verificationAuthorEnabled = true;
  policyActorState.current = null;
  resetIdentityDbForTests();
  resetOrgsStoreForTests();
  resetSourceSetsStoreForTests();
  createOrg({
    id: TEST_ORG_ID,
    displayName: 'New Model VC',
    namespacePrefix: 'org.nmvc',
    createdBy: '@james'
  });
  assignOrgAdmin({
    orgId: TEST_ORG_ID,
    handle: '@james',
    assignedBy: '@admin'
  });
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousFreshDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousFreshDb;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
});

describe('POST /api/source-sets', () => {
  it('creates a source set with admin-bearer', async () => {
    const response = await runHandler(
      createSet as AnyHandler,
      adminPost('/api/source-sets', {
        name: 'FCA Approved Sources',
        owner_org: TEST_ORG_ID,
        created_by: '@james',
        description: 'Primary regulator source list',
        approvers: ['@james', '@mark']
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { sourceSet: { ownerOrg: string; approvers: string[] } };
    expect(body.sourceSet.ownerOrg).toBe(TEST_ORG_ID);
    expect(body.sourceSet.approvers).toEqual(['@james', '@mark']);
  });

  it('creates a source set when caller is org-admin and identity matches', async () => {
    policyActorState.current = { handle: '@james', kind: 'human' };
    const response = await runHandler(
      createSet as AnyHandler,
      identityPost('/api/source-sets', {
        name: 'NMVC trusted partners',
        owner_org: TEST_ORG_ID,
        created_by: '@james'
      })
    );
    expect(response.status).toBe(201);
  });

  it('rejects with 403 when caller is not org-admin of owner_org', async () => {
    policyActorState.current = { handle: '@stranger', kind: 'human' };
    const response = await runHandler(
      createSet as AnyHandler,
      identityPost('/api/source-sets', {
        name: 'Shadow set',
        owner_org: TEST_ORG_ID,
        created_by: '@stranger'
      })
    );
    expect(response.status).toBe(403);
  });

  it('rejects with 401 when caller is anonymous', async () => {
    policyActorState.current = null;
    const response = await runHandler(
      createSet as AnyHandler,
      identityPost('/api/source-sets', {
        name: 'Anon set',
        owner_org: TEST_ORG_ID,
        created_by: '@nobody'
      })
    );
    expect(response.status).toBe(401);
  });

  it('rejects with 400 when created_by mismatches caller identity', async () => {
    policyActorState.current = { handle: '@james', kind: 'human' };
    const response = await runHandler(
      createSet as AnyHandler,
      identityPost('/api/source-sets', {
        name: 'Identity-mismatch set',
        owner_org: TEST_ORG_ID,
        created_by: '@someone-else'
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects with 400 on missing required fields', async () => {
    const response = await runHandler(
      createSet as AnyHandler,
      adminPost('/api/source-sets', { name: 'Missing owner_org', created_by: '@james' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects with 403 when verification author tier is disabled (F2 gate)', async () => {
    featureGateState.verificationAuthorEnabled = false;
    const response = await runHandler(
      createSet as AnyHandler,
      adminPost('/api/source-sets', {
        name: 'Premium-gated',
        owner_org: TEST_ORG_ID,
        created_by: '@james'
      })
    );
    expect(response.status).toBe(403);
  });
});

describe('GET /api/source-sets', () => {
  beforeEach(async () => {
    await runHandler(
      createSet as AnyHandler,
      adminPost('/api/source-sets', {
        name: 'FCA Primary',
        owner_org: TEST_ORG_ID,
        created_by: '@james'
      })
    );
  });

  it('admin sees all source sets', async () => {
    const response = await runHandler(listSets as AnyHandler, adminGet('/api/source-sets'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sourceSets: unknown[] };
    expect(body.sourceSets.length).toBe(1);
  });

  it('org-admin sees their org sets', async () => {
    policyActorState.current = { handle: '@james', kind: 'human' };
    const response = await runHandler(listSets as AnyHandler, anonGet('/api/source-sets'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sourceSets: Array<{ ownerOrg: string }> };
    expect(body.sourceSets.length).toBe(1);
    expect(body.sourceSets[0].ownerOrg).toBe(TEST_ORG_ID);
  });

  it('anonymous caller gets empty list', async () => {
    policyActorState.current = null;
    const response = await runHandler(listSets as AnyHandler, anonGet('/api/source-sets'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sourceSets: unknown[] };
    expect(body.sourceSets).toEqual([]);
  });

  it('caller without org-admin role sees empty list', async () => {
    policyActorState.current = { handle: '@stranger', kind: 'human' };
    const response = await runHandler(listSets as AnyHandler, anonGet('/api/source-sets'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sourceSets: unknown[] };
    expect(body.sourceSets).toEqual([]);
  });
});

describe('GET /api/source-sets/[setId]', () => {
  let createdId: string;

  beforeEach(async () => {
    const createResponse = await runHandler(
      createSet as AnyHandler,
      adminPost('/api/source-sets', {
        name: 'FCA Primary',
        owner_org: TEST_ORG_ID,
        created_by: '@james'
      })
    );
    const body = (await createResponse.json()) as { sourceSet: { id: string } };
    createdId = body.sourceSet.id;
  });

  it('returns the set for admin caller', async () => {
    const event = eventFor(
      'GET',
      `/api/source-sets/${createdId}`,
      { headers: { authorization: `Bearer ${TEST_ADMIN}` } },
      { setId: createdId }
    );
    const response = await runHandler(readSet as AnyHandler, event);
    expect(response.status).toBe(200);
  });

  it('returns 404 for unknown id', async () => {
    const event = eventFor(
      'GET',
      '/api/source-sets/does-not-exist',
      { headers: { authorization: `Bearer ${TEST_ADMIN}` } },
      { setId: 'does-not-exist' }
    );
    const response = await runHandler(readSet as AnyHandler, event);
    expect(response.status).toBe(404);
  });

  it('returns 403 when caller is not org-admin of owner_org', async () => {
    policyActorState.current = { handle: '@stranger', kind: 'human' };
    const event = eventFor(
      'GET',
      `/api/source-sets/${createdId}`,
      {},
      { setId: createdId }
    );
    const response = await runHandler(readSet as AnyHandler, event);
    expect(response.status).toBe(403);
  });

  it('returns 401 when caller is anonymous', async () => {
    policyActorState.current = null;
    const event = eventFor('GET', `/api/source-sets/${createdId}`, {}, { setId: createdId });
    const response = await runHandler(readSet as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('returns the set for org-admin caller', async () => {
    policyActorState.current = { handle: '@james', kind: 'human' };
    const event = eventFor('GET', `/api/source-sets/${createdId}`, {}, { setId: createdId });
    const response = await runHandler(readSet as AnyHandler, event);
    expect(response.status).toBe(200);
  });
});
