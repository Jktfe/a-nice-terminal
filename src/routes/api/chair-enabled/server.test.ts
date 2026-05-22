/**
 * Endpoint-level guardrail for /api/chair-enabled + Chair-disabled boot
 * resilience. Hits actual SvelteKit handlers via runHandler helper —
 * no store-level mocking; tests the endpoint contract.
 *
 * Boundary: 3 endpoints × 2 chair-states (where applicable) = 5 tests.
 * Focus-mode endpoints intentionally excluded (Focus Mode backend slice 1
 * review-held lane). Follow-up slice will cover focus-mode boot-without-Chair
 * once Focus Mode promotes to baseline.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as chairEnabledGet, PUT as chairEnabledPut } from './+server';
import { GET as chatRoomsGet } from '../chat-rooms/+server';
import { GET as asksGet } from '../asks/+server';
import {
  setChairEnabled,
  resetChairEnabledStoreForTests
} from '$lib/server/chairEnabledStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'chair-enabled-test-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'GET' | 'PUT', path: string, body?: string, opts?: { withAuth?: boolean }): unknown {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Auth-fix-9cbf1f0 made GET /api/chat-rooms and GET /api/asks require
  // auth before doing expensive list work. Tests attach the admin bearer
  // by default so the contract under test is "endpoint returns 200 for
  // authenticated callers", not "endpoint is publicly readable".
  if (opts?.withAuth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  const request = new Request(url.toString(), {
    method,
    headers,
    body
  });
  return { request, params: {}, url };
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

describe('/api/chair-enabled + Chair-disabled boot guardrail', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-chair-enabled-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChairEnabledStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('GET /api/chair-enabled returns default-true and PUT toggles it (M4.4 T2: with pidChain)', async () => {
    upsertTerminal({ pid: 9001, pid_start: 'p90', name: '@admin' });
    const initial = await runHandler(
      chairEnabledGet as unknown as AnyHandler,
      eventFor('GET', '/api/chair-enabled')
    );
    expect(initial.status).toBe(200);
    expect((await initial.json()).enabled).toBe(true);

    const turnedOff = await runHandler(
      chairEnabledPut as unknown as AnyHandler,
      eventFor('PUT', '/api/chair-enabled', JSON.stringify({ enabled: false, pidChain: [{ pid: 9001, pid_start: 'p90' }] }))
    );
    expect(turnedOff.status).toBe(200);
    expect((await turnedOff.json()).enabled).toBe(false);
  });

  it('M4.4 T2: PUT 403 when pidChain missing', async () => {
    const response = await runHandler(
      chairEnabledPut as unknown as AnyHandler,
      eventFor('PUT', '/api/chair-enabled', JSON.stringify({ enabled: true }))
    );
    expect(response.status).toBe(403);
  });

  it('M4.4 T2: PUT 403 when pidChain unresolved', async () => {
    const response = await runHandler(
      chairEnabledPut as unknown as AnyHandler,
      eventFor('PUT', '/api/chair-enabled', JSON.stringify({ enabled: true, pidChain: [{ pid: 99999, pid_start: 'fake' }] }))
    );
    expect(response.status).toBe(403);
  });

  it('M4.4 T2: PUT 200 enable=true with valid pidChain', async () => {
    upsertTerminal({ pid: 9002, pid_start: 'p90b', name: '@admin' });
    const response = await runHandler(
      chairEnabledPut as unknown as AnyHandler,
      eventFor('PUT', '/api/chair-enabled', JSON.stringify({ enabled: true, pidChain: [{ pid: 9002, pid_start: 'p90b' }] }))
    );
    expect(response.status).toBe(200);
    expect((await response.json()).enabled).toBe(true);
  });

  it('/api/chat-rooms returns 200 with Chair enabled (default)', async () => {
    const response = await runHandler(
      chatRoomsGet as unknown as AnyHandler,
      eventFor('GET', '/api/chat-rooms')
    );
    expect(response.status).toBe(200);
  });

  it('/api/chat-rooms returns 200 with Chair disabled', async () => {
    setChairEnabled(false);
    const response = await runHandler(
      chatRoomsGet as unknown as AnyHandler,
      eventFor('GET', '/api/chat-rooms')
    );
    expect(response.status).toBe(200);
  });

  it('/api/asks returns 200 with Chair enabled (default)', async () => {
    const response = await runHandler(
      asksGet as unknown as AnyHandler,
      eventFor('GET', '/api/asks')
    );
    expect(response.status).toBe(200);
  });

  it('/api/asks returns 200 with Chair disabled', async () => {
    setChairEnabled(false);
    const response = await runHandler(
      asksGet as unknown as AnyHandler,
      eventFor('GET', '/api/asks')
    );
    expect(response.status).toBe(200);
  });
});
