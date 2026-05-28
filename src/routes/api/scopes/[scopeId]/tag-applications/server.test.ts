/**
 * GET /api/scopes/[scopeId]/tag-applications endpoint tests.
 * Unblocks D2 (iOS tag overlay) by surfacing tag_applications for an
 * anchor / claim / run.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import {
  applyTag,
  createTaggingAnchor,
  resetTagApplicationsStoreForTests,
  startTaggingRun
} from '$lib/server/tagApplicationsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(path: string, params: Record<string, string> = {}): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method: 'GET' });
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-tag-apps-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetTagApplicationsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

function makeAppsForAnchor() {
  const run = startTaggingRun({
    scopeId: 'X', scopeKind: 'artefact',
    initiatorHandle: '@a', initiatorKind: 'agent'
  });
  const anchor = createTaggingAnchor({
    contentKind: 'markdown-offset', contentId: 'doc-1', contentHash: 'h',
    anchorData: { range: 'p1' }, createdBy: '@a'
  });
  const a1 = applyTag({
    tagId: 'ant.claim.factual', tagVersion: 1,
    targetAnchorId: anchor.id,
    applicatorHandle: '@a', applicatorKind: 'agent',
    taggingRunId: run.id
  });
  const a2 = applyTag({
    tagId: 'ant.source.primary', tagVersion: 1,
    targetAnchorId: anchor.id,
    applicatorHandle: '@a', applicatorKind: 'agent',
    taggingRunId: run.id
  });
  return { run, anchor, applications: [a1, a2] };
}

describe('GET /api/scopes/[scopeId]/tag-applications', () => {
  it('TA1: ?anchor= returns applications for that anchor', async () => {
    const { anchor, applications } = makeAppsForAnchor();
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications?anchor=${anchor.id}`, { scopeId: 'X' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applications).toHaveLength(2);
    expect(body.applications.map((a: { id: string }) => a.id).sort())
      .toEqual(applications.map((a) => a.id).sort());
  });

  it('TA2: ?run= returns applications for that tagging run', async () => {
    const { run, applications } = makeAppsForAnchor();
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications?run=${run.id}`, { scopeId: 'X' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applications).toHaveLength(2);
  });

  it('TA3: ?claim= returns relational tag applications targeting that claim', async () => {
    const run = startTaggingRun({
      scopeId: 'X', scopeKind: 'artefact',
      initiatorHandle: '@a', initiatorKind: 'agent'
    });
    const anchor = createTaggingAnchor({
      contentKind: 'markdown-offset', contentId: 'doc-1', contentHash: 'h',
      anchorData: { range: 'src' }, createdBy: '@a'
    });
    applyTag({
      tagId: 'ant.source.supports-claim.claim-42', tagVersion: 1,
      targetAnchorId: anchor.id, targetClaimId: 'claim-42',
      applicatorHandle: '@a', applicatorKind: 'agent',
      taggingRunId: run.id
    });
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications?claim=claim-42`, { scopeId: 'X' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].targetClaimId).toBe('claim-42');
  });

  it('TA4: no filter returns 400', async () => {
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications`, { scopeId: 'X' }));
    expect(response.status).toBe(400);
  });

  it('TA5: multiple filters return 400 (no combined scan path)', async () => {
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications?anchor=a1&claim=c1`, { scopeId: 'X' }));
    expect(response.status).toBe(400);
  });

  it('TA6: open read — no auth header needed', async () => {
    const { anchor } = makeAppsForAnchor();
    // Plain GET, no Authorization header
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications?anchor=${anchor.id}`, { scopeId: 'X' }));
    expect(response.status).toBe(200);
  });

  it('TA7: empty result returns 200 with empty array', async () => {
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor(`/api/scopes/X/tag-applications?anchor=anchor-nope`, { scopeId: 'X' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applications).toEqual([]);
  });
});
