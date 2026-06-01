import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { GET as auditGet } from '../audit/+server';
import {
  applyTag,
  createTaggingAnchor,
  resetTagApplicationsStoreForTests,
  startTaggingRun
} from '$lib/server/tagApplicationsStore';
import { resetTagApplicationOverridesStoreForTests } from '$lib/server/tagApplicationOverridesStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'rba_test_overrides';

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

function authedPost(applicationId: string, body: unknown, token = TEST_ADMIN): unknown {
  return eventFor('POST', `/api/tag-applications/${applicationId}/protocol-override`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  }, { applicationId });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-app-override-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  resetIdentityDbForTests();
  resetTagApplicationOverridesStoreForTests();
  resetTagApplicationsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminBearer;
});

function freshApplication() {
  const run = startTaggingRun({
    scopeId: 'X', scopeKind: 'artefact',
    initiatorHandle: '@a', initiatorKind: 'agent'
  });
  const anchor = createTaggingAnchor({
    contentKind: 'markdown-offset', contentId: 'X', contentHash: 'h',
    anchorData: {}, createdBy: '@a'
  });
  return applyTag({
    tagId: 'ant.claim.factual', tagVersion: 1,
    targetAnchorId: anchor.id,
    applicatorHandle: '@a', applicatorKind: 'agent',
    taggingRunId: run.id
  });
}

describe('POST /api/tag-applications/[applicationId]/protocol-override', () => {
  it('PO1: records a flag_ignorable override with mandatory reason', async () => {
    const app = freshApplication();
    const response = await runHandler(POST as unknown as AnyHandler,
      authedPost(app.id, {
        override_kind: 'flag_ignorable',
        handler_handle: '@james',
        handler_kind: 'human',
        reason: 'this is a joke claim'
      }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.override.overrideKind).toBe('flag_ignorable');
    expect(body.override.reason).toBe('this is a joke claim');
  });

  it('PO2: records a classification override with new_protocol_class', async () => {
    const app = freshApplication();
    const response = await runHandler(POST as unknown as AnyHandler,
      authedPost(app.id, {
        override_kind: 'classification',
        new_protocol_class: 'heuristic',
        handler_handle: '@james',
        handler_kind: 'human',
        reason: 'context warrants heuristic, not consensus'
      }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.override.newProtocolClass).toBe('heuristic');
  });

  it('PO3: rejects missing admin bearer with 401', async () => {
    const app = freshApplication();
    const event = eventFor('POST', `/api/tag-applications/${app.id}/protocol-override`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ override_kind: 'flag_ignorable', handler_handle: '@a', handler_kind: 'human', reason: 'r' })
    }, { applicationId: app.id });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('PO4: rejects empty reason with 400 (audit invariant)', async () => {
    const app = freshApplication();
    const response = await runHandler(POST as unknown as AnyHandler,
      authedPost(app.id, {
        override_kind: 'flag_ignorable', handler_handle: '@a', handler_kind: 'human', reason: '   '
      }));
    expect(response.status).toBe(400);
  });

  it('PO5: rejects invalid override_kind with 400', async () => {
    const app = freshApplication();
    const response = await runHandler(POST as unknown as AnyHandler,
      authedPost(app.id, {
        override_kind: 'bogus', handler_handle: '@a', handler_kind: 'human', reason: 'r'
      }));
    expect(response.status).toBe(400);
  });

  it('PO6: returns 404 for non-existent application', async () => {
    const response = await runHandler(POST as unknown as AnyHandler,
      authedPost('tapp-nope', {
        override_kind: 'flag_ignorable', handler_handle: '@a', handler_kind: 'human', reason: 'r'
      }));
    expect(response.status).toBe(404);
  });
});

describe('GET /api/tag-applications/[applicationId]/audit', () => {
  it('PO7: returns override chain newest-first + computed effective', async () => {
    const app = freshApplication();
    // Two overrides — flag_ignorable, then withdraw
    await runHandler(POST as unknown as AnyHandler,
      authedPost(app.id, { override_kind: 'flag_ignorable', handler_handle: '@a', handler_kind: 'human', reason: 'first' }));
    await runHandler(POST as unknown as AnyHandler,
      authedPost(app.id, { override_kind: 'withdraw', handler_handle: '@a', handler_kind: 'human', reason: 'changed mind' }));

    const response = await runHandler(auditGet as unknown as AnyHandler,
      eventFor('GET', `/api/tag-applications/${app.id}/audit`, {}, { applicationId: app.id }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.overrides).toHaveLength(2);
    // Newest-first
    expect(body.overrides[0].overrideKind).toBe('withdraw');
    expect(body.overrides[1].overrideKind).toBe('flag_ignorable');
    // Withdraw cancels the flag_ignorable → effective null
    expect(body.effective).toBeNull();
  });

  it('PO8: returns empty chain + null effective for app with no overrides', async () => {
    const app = freshApplication();
    const response = await runHandler(auditGet as unknown as AnyHandler,
      eventFor('GET', `/api/tag-applications/${app.id}/audit`, {}, { applicationId: app.id }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.overrides).toEqual([]);
    expect(body.effective).toBeNull();
  });
});
