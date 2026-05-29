/**
 * /api/grants endpoint tests — Stage A grants_shim CLI surface (plan
 * milestone p3-stage-a-grant-cli of ant-substrate-v0.2-2026-05-29).
 *
 * Covers T4 + T5 of the PR spec at the HTTP layer:
 *   T4 grant insert → lookupActiveGrant finds the row.
 *   T5 grant + revoke → lookupActiveGrant returns null.
 * Plus 400/401 contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, DELETE } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  lookupActiveGrant,
  resetGrantsShimForTests
} from '$lib/server/grantsShimStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-grants-tests';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'POST' | 'DELETE',
  init: RequestInit
): unknown {
  const url = new URL('http://localhost/api/grants');
  const request = new Request(url.toString(), { method, ...init });
  return { request, params: {}, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: unknown };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-grants-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  resetIdentityDbForTests();
  resetGrantsShimForTests();
});

afterEach(() => {
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/grants — POST', () => {
  it('T4: admin-bearer POST writes a grants_shim row + lookup succeeds', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { grant?: { grantId?: string } };
    expect(body.grant?.grantId).toMatch(/^gr_/);
    const found = lookupActiveGrant({
      granteeHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: 'orsz2321qb'
    });
    expect(found).not.toBeNull();
    expect(found?.grantedByHandle).toBe('@admin');
  });

  it('rejects when no caller identity resolves (401)', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('rejects malformed body (400) — missing granteeHandle', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects invalid targetKind (400)', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'mystery',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects invalid scope (400)', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        scope: 'forever'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('honours scope=always-for-room on the wire', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        scope: 'always-for-room'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const found = lookupActiveGrant({
      granteeHandle: '@x',
      action: 'chat.post',
      targetKind: 'room',
      targetId: 'r1'
    });
    expect(found?.scope).toBe('always-for-room');
  });
});

describe('/api/grants — DELETE', () => {
  it('T5: DELETE revokes an active grant + lookup returns null', async () => {
    // Seed via POST.
    await runHandler(
      POST as AnyHandler,
      eventFor('POST', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@speedyc',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'orsz2321qb'
        })
      })
    );
    expect(
      lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      })
    ).not.toBeNull();
    // Now revoke.
    const response = await runHandler(
      DELETE as AnyHandler,
      eventFor('DELETE', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@speedyc',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'orsz2321qb'
        })
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(1);
    expect(
      lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      })
    ).toBeNull();
  });

  it('returns revokedCount=0 when no active grant exists', async () => {
    const response = await runHandler(
      DELETE as AnyHandler,
      eventFor('DELETE', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@nobody',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'r1'
        })
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(0);
  });

  it('rejects unauthenticated revoke (401)', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor('DELETE', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(DELETE as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});
