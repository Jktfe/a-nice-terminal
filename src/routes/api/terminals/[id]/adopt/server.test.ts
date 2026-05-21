import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { lookupTerminalByPidChain } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'adopt-admin-token';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminal-adopt-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
});

function postReq(
  id: string,
  body: unknown,
  token: string | null = ADMIN_TOKEN
): Parameters<typeof POST>[0] {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    params: { id },
    request: new Request(`http://localhost/api/terminals/${encodeURIComponent(id)}/adopt`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

describe('POST /api/terminals/:id/adopt', () => {
  it('requires admin auth', async () => {
    createTerminalRecord({ sessionId: 't_adopt', name: 'Adopt Me', handle: '@adoptme' });

    await expect(POST(postReq('t_adopt', { pid: 777, pidStart: 'start' }, null))).rejects.toMatchObject({
      status: 401
    });
    await expect(POST(postReq('t_adopt', { pid: 777, pidStart: 'start' }, 'wrong'))).rejects.toMatchObject({
      status: 401
    });
  });

  it('binds an external pidChain to an existing terminal identity', async () => {
    createTerminalRecord({
      sessionId: 't_adopt',
      name: 'Adopt Me',
      handle: '@adoptme',
      agentKind: 'claude',
      tmuxTargetPane: 'external:0.0'
    });
    expect(lookupTerminalByPidChain([{ pid: 777, pid_start: 'Tue May 19 17:45:00 2026' }])).toBeNull();

    const response = await POST(postReq('t_adopt', {
      pid: 777,
      pidStart: 'Tue May 19 17:45:00 2026',
      ttlSeconds: 900,
      reason: 'bring old Claude session into ANT'
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      terminalId: 't_adopt',
      handle: '@adoptme',
      adopted: {
        pid: 777,
        pidStart: 'Tue May 19 17:45:00 2026',
        ttlSeconds: 900
      }
    });
    const resolved = lookupTerminalByPidChain([{ pid: 777, pid_start: 'Tue May 19 17:45:00 2026' }]);
    expect(resolved).toMatchObject({
      id: 't_adopt',
      name: 'Adopt Me',
      source: 'adopt'
    });
  });

  it('rejects missing terminal records and invalid pid bodies', async () => {
    await expect(POST(postReq('missing', { pid: 777, pidStart: 'start' }))).rejects.toMatchObject({
      status: 404
    });

    createTerminalRecord({ sessionId: 't_adopt', name: 'Adopt Me' });
    await expect(POST(postReq('t_adopt', { pid: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(POST(postReq('t_adopt', { pid: 777 }))).rejects.toMatchObject({ status: 400 });
    await expect(POST(postReq('t_adopt', { pid: 777, ttlSeconds: 30 }))).rejects.toMatchObject({ status: 400 });
  });
});
