/**
 * /api/verification/lenses/[lensId]/tag-rows endpoint tests — A9 Slice 7b.
 * Covers POST (create row) + GET (list) + DELETE (per-row removal).
 */

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
import { DELETE as deleteRow, GET as getRow } from './[rowId]/+server';
import { resetLensTagRowsStoreForTests } from '$lib/server/lensTagRowsStore';
import { createValidationSchema } from '$lib/server/validationLensStore';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminBearer = process.env.ANT_ADMIN_BEARER;
const TEST_ADMIN = 'rba_test_token_for_ltr';

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

function authed(method: string, path: string, body: unknown, params: Record<string, string>, token = TEST_ADMIN): unknown {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return eventFor(method, path, {
    headers, body: body !== undefined ? JSON.stringify(body) : undefined
  }, params);
}

function freshLens(id: string) {
  return createValidationSchema({
    id, name: id, description: null, lensKind: 'custom', scope: 'public',
    scopeId: 'global', rulesJson: '[]', createdBy: '@test', archivedAtMs: null
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-lens-tag-rows-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_BEARER = TEST_ADMIN;
  featureGateState.verificationAuthorEnabled = true;
  resetIdentityDbForTests();
  resetLensTagRowsStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminBearer === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = previousAdminBearer;
});

describe('POST /api/verification/lenses/[lensId]/tag-rows', () => {
  it('LTR1: creates a row with sensible defaults, returns 201', async () => {
    const lens = freshLens('lens-r1');
    const response = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'ant.claim.factual',
        expectation: 'required',
        author_handle: '@admin'
      }, { lensId: lens.id }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.row.lensId).toBe(lens.id);
    expect(body.row.disputePolicy).toBe('majority');
    expect(body.row.minVerifierCount).toBe(1);
    expect(body.row.weight).toBe(1.0);
  });

  it('LTR2: accepts full configuration with verifier_mix + custom dispute policy', async () => {
    const lens = freshLens('lens-r2');
    const response = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'ant.source.primary',
        tag_version: 2,
        expectation: 'consensus-required',
        min_verifier_count: 3,
        verifier_mix: ['@v1', '@v2', '@v3'],
        dispute_policy: 'unanimous',
        weight: 2.5,
        notes: 'critical claim',
        author_handle: '@admin'
      }, { lensId: lens.id }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.row.tagVersion).toBe(2);
    expect(body.row.verifierMix).toEqual(['@v1', '@v2', '@v3']);
    expect(body.row.disputePolicy).toBe('unanimous');
  });

  it('LTR3: rejects orphan rows (lens does not exist) with 404', async () => {
    const response = await runHandler(POST as unknown as AnyHandler,
      authed('POST', '/api/verification/lenses/lens-nope/tag-rows', {
        tag_id: 'x', expectation: 'required', author_handle: '@a'
      }, { lensId: 'lens-nope' }));
    expect(response.status).toBe(404);
  });

  it('LTR4: rejects invalid expectation with 400', async () => {
    const lens = freshLens('lens-r4');
    const response = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'x', expectation: 'bogus', author_handle: '@a'
      }, { lensId: lens.id }));
    expect(response.status).toBe(400);
  });

  it('LTR5: rejects invalid dispute_policy with 400', async () => {
    const lens = freshLens('lens-r5');
    const response = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'x', expectation: 'required', dispute_policy: 'made-up',
        author_handle: '@a'
      }, { lensId: lens.id }));
    expect(response.status).toBe(400);
  });

  it('LTR6: rejects missing admin bearer with 401', async () => {
    const lens = freshLens('lens-r6');
    const event = eventFor('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag_id: 'x', expectation: 'required', author_handle: '@a' })
    }, { lensId: lens.id });
    const response = await runHandler(POST as unknown as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('LTR6b: blocks OSS tier with 403 even when admin-bearer is valid (F2 author gate)', async () => {
    const lens = freshLens('lens-r6b');
    featureGateState.verificationAuthorEnabled = false;
    const response = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'x', expectation: 'required', author_handle: '@a'
      }, { lensId: lens.id }));
    expect(response.status).toBe(403);
  });
});

describe('GET /api/verification/lenses/[lensId]/tag-rows', () => {
  it('LTR7: lists rows for a lens (open read, no auth required)', async () => {
    const lens = freshLens('lens-list');
    await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'tag1', expectation: 'required', author_handle: '@a'
      }, { lensId: lens.id }));
    await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 'tag2', expectation: 'forbidden', author_handle: '@a'
      }, { lensId: lens.id }));
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor('GET', `/api/verification/lenses/${lens.id}/tag-rows`, {}, { lensId: lens.id }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(2);
  });
});

describe('DELETE /api/verification/lenses/[lensId]/tag-rows/[rowId]', () => {
  it('LTR8: deletes a row, returns 204', async () => {
    const lens = freshLens('lens-del');
    const created = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 't', expectation: 'required', author_handle: '@a'
      }, { lensId: lens.id }));
    const { row } = await created.json();
    const response = await runHandler(deleteRow as unknown as AnyHandler,
      authed('DELETE', `/api/verification/lenses/${lens.id}/tag-rows/${row.id}`,
        undefined, { lensId: lens.id, rowId: row.id }));
    expect(response.status).toBe(204);
  });

  it('LTR9: returns 404 when rowId belongs to a different lens (path mismatch)', async () => {
    const lensA = freshLens('lens-a');
    const lensB = freshLens('lens-b');
    const created = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lensA.id}/tag-rows`, {
        tag_id: 't', expectation: 'required', author_handle: '@a'
      }, { lensId: lensA.id }));
    const { row } = await created.json();
    // Try to delete it via lensB's path
    const response = await runHandler(deleteRow as unknown as AnyHandler,
      authed('DELETE', `/api/verification/lenses/${lensB.id}/tag-rows/${row.id}`,
        undefined, { lensId: lensB.id, rowId: row.id }));
    expect(response.status).toBe(404);
  });

  it('LTR10: returns 404 for non-existent row', async () => {
    const lens = freshLens('lens-x');
    const response = await runHandler(deleteRow as unknown as AnyHandler,
      authed('DELETE', `/api/verification/lenses/${lens.id}/tag-rows/ltr-nope`,
        undefined, { lensId: lens.id, rowId: 'ltr-nope' }));
    expect(response.status).toBe(404);
  });

  it('LTR11: blocks OSS tier with 403 even when admin-bearer is valid (F2 author gate)', async () => {
    const lens = freshLens('lens-del-oss');
    const created = await runHandler(POST as unknown as AnyHandler,
      authed('POST', `/api/verification/lenses/${lens.id}/tag-rows`, {
        tag_id: 't', expectation: 'required', author_handle: '@a'
      }, { lensId: lens.id }));
    const { row } = await created.json();
    featureGateState.verificationAuthorEnabled = false;
    const response = await runHandler(deleteRow as unknown as AnyHandler,
      authed('DELETE', `/api/verification/lenses/${lens.id}/tag-rows/${row.id}`,
        undefined, { lensId: lens.id, rowId: row.id }));
    expect(response.status).toBe(403);
  });
});
