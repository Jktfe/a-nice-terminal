/**
 * /api/orgs endpoint tests — F1 license-time namespace provisioning.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { resetOrgsStoreForTests } from '$lib/server/orgsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_orgs';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'POST' | 'GET', path: string, init: RequestInit, params: Record<string, string> = {}): unknown {
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

function authedPost(body: unknown, token: string = TEST_ADMIN): unknown {
  return eventFor('POST', '/api/orgs', {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-orgs-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  resetIdentityDbForTests();
  resetOrgsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

describe('/api/orgs POST', () => {
  it('O1: registers a new org + returns 201 with org payload', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'acme',
      display_name: 'Acme Holdings',
      namespace_prefix: 'org.acme',
      tier: 'premium',
      created_by: '@james'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.org.id).toBe('acme');
    expect(body.org.namespacePrefix).toBe('org.acme');
    expect(body.org.tier).toBe('premium');
    expect(body.org.archivedAtMs).toBeNull();
  });

  it('O2: defaults tier to oss when omitted', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'a', display_name: 'A', namespace_prefix: 'org.a', created_by: '@x'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.org.tier).toBe('oss');
  });

  it('O3: missing admin bearer returns 401', async () => {
    const event = eventFor('POST', '/api/orgs', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'a', display_name: 'A', namespace_prefix: 'org.a', created_by: '@x' })
    });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('O4: wrong admin token returns 403', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'a', display_name: 'A', namespace_prefix: 'org.a', created_by: '@x'
    }, 'wrong-token'));
    expect(response.status).toBe(403);
  });

  it('O5: missing required field returns 400', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'a', display_name: 'A', created_by: '@x'
    }));
    expect(response.status).toBe(400);
  });

  it('O6: invalid tier returns 400', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'a', display_name: 'A', namespace_prefix: 'org.a', tier: 'gold', created_by: '@x'
    }));
    expect(response.status).toBe(400);
  });

  it('O7: duplicate namespace_prefix returns 409', async () => {
    await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'a', display_name: 'A', namespace_prefix: 'org.shared', created_by: '@x'
    }));
    const response = await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'b', display_name: 'B', namespace_prefix: 'org.shared', created_by: '@x'
    }));
    expect(response.status).toBe(409);
  });
});

describe('/api/orgs GET', () => {
  it('O8: lists orgs (newest first), open read no auth', async () => {
    await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'a', display_name: 'A', namespace_prefix: 'org.a', created_by: '@x'
    }));
    await runHandler(POST as unknown as AnyHandler, authedPost({
      id: 'b', display_name: 'B', namespace_prefix: 'org.b', created_by: '@x'
    }));
    const event = eventFor('GET', '/api/orgs', {});
    const response = await runHandler(GET as unknown as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orgs).toHaveLength(2);
    expect(body.orgs.map((o: { id: string }) => o.id).sort()).toEqual(['a', 'b']);
  });

  it('O9: GET returns empty list when no orgs', async () => {
    const event = eventFor('GET', '/api/orgs', {});
    const response = await runHandler(GET as unknown as AnyHandler, event);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orgs).toEqual([]);
  });
});
