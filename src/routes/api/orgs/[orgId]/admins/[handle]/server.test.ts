/**
 * /api/orgs/[orgId]/admins/[handle] endpoint tests — F1 admin revoke.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DELETE } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  assignOrgAdmin,
  createOrg,
  isOrgAdmin,
  resetOrgsStoreForTests
} from '$lib/server/orgsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_revoke';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'DELETE', path: string, init: RequestInit, params: Record<string, string>): unknown {
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

function authedDelete(orgId: string, handle: string, token: string = TEST_ADMIN, revokedBy?: string): unknown {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (revokedBy) headers['x-revoked-by'] = revokedBy;
  return eventFor('DELETE', `/api/orgs/${orgId}/admins/${encodeURIComponent(handle)}`, {
    headers
  }, { orgId, handle: encodeURIComponent(handle) });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-orgs-admin-revoke-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  resetIdentityDbForTests();
  resetOrgsStoreForTests();
  createOrg({ id: 'acme', displayName: 'Acme', namespacePrefix: 'org.acme', createdBy: '@james' });
  assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

describe('/api/orgs/[orgId]/admins/[handle] DELETE', () => {
  it('OR1: revokes active admin, returns 204', async () => {
    const response = await runHandler(DELETE as unknown as AnyHandler, authedDelete('acme', '@james', TEST_ADMIN, '@speedycodex'));
    expect(response.status).toBe(204);
    expect(isOrgAdmin('acme', '@james')).toBe(false);
  });

  it('OR2: missing admin bearer returns 401', async () => {
    const event = eventFor('DELETE', '/api/orgs/acme/admins/%40james', { headers: {} }, {
      orgId: 'acme', handle: '%40james'
    });
    const response = await runHandler(DELETE as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('OR3: returns 404 when no active row to revoke', async () => {
    const response = await runHandler(DELETE as unknown as AnyHandler, authedDelete('acme', '@nobody'));
    expect(response.status).toBe(404);
  });

  it('OR4: returns 404 on missing org', async () => {
    const response = await runHandler(DELETE as unknown as AnyHandler, authedDelete('missing', '@james'));
    expect(response.status).toBe(404);
  });
});
