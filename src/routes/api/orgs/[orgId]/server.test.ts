/**
 * /api/orgs/[orgId] endpoint tests — single org read.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createOrg, resetOrgsStoreForTests } from '$lib/server/orgsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(path: string, params: Record<string, string>): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method: 'GET' });
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-orgs-single-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetOrgsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('/api/orgs/[orgId] GET', () => {
  it('OS1: returns the org row when found', async () => {
    createOrg({ id: 'acme', displayName: 'Acme', namespacePrefix: 'org.acme', createdBy: '@james' });
    const response = await runHandler(GET as unknown as AnyHandler, eventFor('/api/orgs/acme', { orgId: 'acme' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.org.id).toBe('acme');
    expect(body.org.displayName).toBe('Acme');
  });

  it('OS2: returns 404 when org missing', async () => {
    const response = await runHandler(GET as unknown as AnyHandler, eventFor('/api/orgs/missing', { orgId: 'missing' }));
    expect(response.status).toBe(404);
  });
});
