import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, GET } from './+server';
import {
  listCliHookEventsForSession,
  resetCliHookEventsStoreForTests
} from '$lib/server/cliHookEventsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'POST' | 'GET', path: string, init?: RequestInit): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...(init ?? {}) });
  return { request, params: {}, url };
}

function postBody(path: string, body: unknown, extraHeaders?: Record<string, string>): unknown {
  return eventFor('POST', path, {
    headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
    body: JSON.stringify(body)
  });
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

describe('/api/hooks legacy shim', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-hooks-route-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  it('POST captures valid legacy hook payloads instead of dropping them', async () => {
    const response = await runHandler(
      POST as unknown as AnyHandler,
      postBody('/api/hooks', {
        session_id: 'legacy-session',
        hook_event_name: 'SessionStart',
        cwd: '/Users/james/project'
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { source_cli: string };
    expect(body.source_cli).toBe('legacy-hooks');
    const rows = listCliHookEventsForSession('legacy-session');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_cli: 'legacy-hooks',
      hook_event_name: 'SessionStart',
      cwd: '/Users/james/project'
    });
  });

  it('POST preserves an explicit source query parameter', async () => {
    const response = await runHandler(
      POST as unknown as AnyHandler,
      postBody('/api/hooks?source=codex', {
        session_id: 'codex-session',
        hook_event_name: 'PostToolUse'
      })
    );

    expect(response.status).toBe(201);
    const [row] = listCliHookEventsForSession('codex-session');
    expect(row.source_cli).toBe('codex');
  });

  it('POST returns validation errors instead of false-success 204s', async () => {
    const response = await runHandler(
      POST as unknown as AnyHandler,
      postBody('/api/hooks', { hook_event_name: 'SessionStart' })
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('session_id');
  });

  it('GET points operators at the real receiver', async () => {
    const response = await runHandler(GET as unknown as AnyHandler, eventFor('GET', '/api/hooks'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { receiver: string; message: string };
    expect(body.receiver).toBe('/api/cli-hook');
    expect(body.message).toContain('/api/cli-hook');
  });
});
