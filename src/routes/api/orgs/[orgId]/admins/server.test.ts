/**
 * /api/orgs/[orgId]/admins endpoint tests — F1 admin assign + list.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createOrg, resetOrgsStoreForTests } from '$lib/server/orgsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_org_admins';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'GET' | 'POST', path: string, init: RequestInit, params: Record<string, string>): unknown {
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
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function authedPost(orgId: string, body: unknown, token: string = TEST_ADMIN): unknown {
  return eventFor('POST', `/api/orgs/${orgId}/admins`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, { orgId });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-orgs-admins-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  resetIdentityDbForTests();
  resetOrgsStoreForTests();
  createOrg({ id: 'acme', displayName: 'Acme', namespacePrefix: 'org.acme', createdBy: '@james' });
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

describe('/api/orgs/[orgId]/admins POST', () => {
  it('OA1: assigns an org-admin + returns 201 with admin payload', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('acme', {
      handle: '@james',
      assigned_by: '@system'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.admin.handle).toBe('@james');
    expect(body.admin.orgId).toBe('acme');
    expect(body.admin.revokedAtMs).toBeNull();
  });

  it('OA2: idempotent — second assign returns same row', async () => {
    const first = await (await runHandler(POST as unknown as AnyHandler, authedPost('acme', {
      handle: '@james', assigned_by: '@system'
    }))).json();
    const second = await (await runHandler(POST as unknown as AnyHandler, authedPost('acme', {
      handle: '@james', assigned_by: '@system'
    }))).json();
    expect(second.admin.id).toBe(first.admin.id);
  });

  it('OA3: missing admin bearer returns 401', async () => {
    const event = eventFor('POST', '/api/orgs/acme/admins', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@james', assigned_by: '@system' })
    }, { orgId: 'acme' });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('OA4: missing handle returns 400', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('acme', {
      assigned_by: '@system'
    }));
    expect(response.status).toBe(400);
  });

  it('OA5: assigning admin on missing org returns 404', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('missing', {
      handle: '@james', assigned_by: '@system'
    }));
    expect(response.status).toBe(404);
  });
});

describe('/api/orgs/[orgId]/admins GET', () => {
  it('OA6: lists active admins for the org (open read)', async () => {
    await runHandler(POST as unknown as AnyHandler, authedPost('acme', {
      handle: '@james', assigned_by: '@system'
    }));
    await runHandler(POST as unknown as AnyHandler, authedPost('acme', {
      handle: '@speedycodex', assigned_by: '@james'
    }));
    const event = eventFor('GET', '/api/orgs/acme/admins', {}, { orgId: 'acme' });
    const response = await runHandler(GET as unknown as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.admins.map((a: { handle: string }) => a.handle).sort()).toEqual(['@james', '@speedycodex']);
  });

  it('OA7: 404 when listing on missing org', async () => {
    const event = eventFor('GET', '/api/orgs/missing/admins', {}, { orgId: 'missing' });
    const response = await runHandler(GET as unknown as AnyHandler, event);
    expect(response.status).toBe(404);
  });
});
