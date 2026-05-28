/**
 * /api/scopes/[scopeId]/tagging-runs endpoint tests — A9 / Slice 7a.
 *
 * Covers POST atomic-batch + start-only modes + admin bearer gate +
 * body validation + applyTag failure surface.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import {
  createTaggingAnchor,
  resetTagApplicationsStoreForTests
} from '$lib/server/tagApplicationsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_a9';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'POST', path: string, init: RequestInit, params: Record<string, string>): unknown {
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

function authedPost(scopeId: string, body: unknown, token: string = TEST_ADMIN): unknown {
  return eventFor('POST', `/api/scopes/${scopeId}/tagging-runs`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, { scopeId });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-tagging-runs-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  resetIdentityDbForTests();
  resetTagApplicationsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

describe('/api/scopes/[scopeId]/tagging-runs POST', () => {
  it('TR1: atomic batch creates run + applies tags + completes run, returns 201', async () => {
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset', contentId: 'doc-1', contentHash: 'h',
      anchorData: { range: 'p1' }, createdBy: '@test'
    });
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('artefact-1', {
      scope_kind: 'artefact',
      initiator_handle: '@speedyclaude',
      initiator_kind: 'agent',
      run_reason: 'periodic re-tag',
      applications: [{
        tag_id: 'ant.claim.factual', tag_version: 1, target_anchor_id: anchor.id,
        applicator_handle: '@speedyclaude', applicator_kind: 'agent'
      }, {
        tag_id: 'ant.source.primary', tag_version: 1, target_anchor_id: anchor.id,
        applicator_handle: '@speedyclaude', applicator_kind: 'agent'
      }]
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.run.completedAtMs).toBeGreaterThan(0);
    expect(body.run.applicationCount).toBe(2);
    expect(body.applications).toHaveLength(2);
    expect(body.applications[0].tagId).toBe('ant.claim.factual');
  });

  it('TR2: start-only mode (no applications) leaves run in-flight', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('artefact-1', {
      scope_kind: 'artefact',
      initiator_handle: '@a',
      initiator_kind: 'human'
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.run.completedAtMs).toBeNull();
    expect(body.applications).toEqual([]);
  });

  it('TR3: missing admin bearer returns 401', async () => {
    const event = eventFor('POST', '/api/scopes/x/tagging-runs', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope_kind: 'artefact', initiator_handle: '@a', initiator_kind: 'human' })
    }, { scopeId: 'x' });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('TR4: invalid scope_kind returns 400', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      scope_kind: 'bogus',
      initiator_handle: '@a',
      initiator_kind: 'human'
    }));
    expect(response.status).toBe(400);
  });

  it('TR5: applyTag failure (anchor does not exist) surfaces 400 with cause', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      scope_kind: 'artefact',
      initiator_handle: '@a',
      initiator_kind: 'human',
      applications: [{
        tag_id: 'ant.claim.factual', tag_version: 1, target_anchor_id: 'anchor-nope',
        applicator_handle: '@a', applicator_kind: 'human'
      }]
    }));
    expect(response.status).toBe(400);
  });

  it('TR6: missing required fields on application returns 400', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, authedPost('x', {
      scope_kind: 'artefact',
      initiator_handle: '@a',
      initiator_kind: 'human',
      applications: [{ tag_id: 'only-tag' }]
    }));
    expect(response.status).toBe(400);
  });
});
