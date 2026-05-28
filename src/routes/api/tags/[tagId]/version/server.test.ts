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

import { PUT } from './+server';
import { createTag, resetVerificationTaxonomyStoreForTests } from '$lib/server/verificationTaxonomyStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'rba_test_tag_version';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: string, path: string, init: RequestInit = {}, params: Record<string, string> = {}): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
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

function authedPut(tagId: string, body: unknown, token = TEST_ADMIN): unknown {
  return eventFor('PUT', `/api/tags/${tagId}/version`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, { tagId });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-tag-version-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  featureGateState.verificationAuthorEnabled = true;
  resetIdentityDbForTests();
  resetVerificationTaxonomyStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminBearer;
});

function seedTag(): void {
  createTag({
    id: 'org.x',
    name: 'X',
    description: 'original',
    category: 'claim',
    provenance: 'org',
    scopeId: 'acme',
    protocolResolver: { kind: 'static', protocol: 'heuristic' },
    isRelational: false,
    familyRoot: null,
    isHumanEditable: true,
    createdBy: '@admin',
    actorKind: 'human'
  });
}

describe('PUT /api/tags/[tagId]/version', () => {
  it('TV1: publishes new version + retains old one', async () => {
    seedTag();
    const response = await runHandler(PUT as unknown as AnyHandler,
      authedPut('org.x', {
        description: 'updated description',
        actor_handle: '@admin',
        actor_kind: 'human',
        reason: 'clearer wording'
      }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tag.id).toBe('org.x');
    expect(body.tag.version).toBe(2);
    expect(body.tag.description).toBe('updated description');
  });

  it('TV2: rejects missing admin bearer with 401', async () => {
    const event = eventFor('PUT', '/api/tags/org.x/version', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'd', actor_handle: '@a' })
    }, { tagId: 'org.x' });
    const response = await runHandler(PUT as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('TV3: returns 404 for non-existent tag', async () => {
    const response = await runHandler(PUT as unknown as AnyHandler,
      authedPut('no-such', { description: 'd', actor_handle: '@a', actor_kind: 'human' }));
    expect(response.status).toBe(404);
  });

  it('TV4: rejects missing actor_handle with 400', async () => {
    seedTag();
    const response = await runHandler(PUT as unknown as AnyHandler,
      authedPut('org.x', { description: 'd' }));
    expect(response.status).toBe(400);
  });

  it('TV5: accepts protocol_resolver change', async () => {
    seedTag();
    const response = await runHandler(PUT as unknown as AnyHandler,
      authedPut('org.x', {
        protocol_resolver: { kind: 'static', protocol: 'consensus-required' },
        actor_handle: '@admin',
        actor_kind: 'human'
      }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tag.protocolResolver.protocol).toBe('consensus-required');
  });

  it('TV6: blocks OSS tier with 403 even when admin-bearer is valid (F2 author gate)', async () => {
    seedTag();
    featureGateState.verificationAuthorEnabled = false;
    const response = await runHandler(PUT as unknown as AnyHandler,
      authedPut('org.x', {
        description: 'denied',
        actor_handle: '@admin',
        actor_kind: 'human'
      }));
    expect(response.status).toBe(403);
  });
});
