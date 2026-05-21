/**
 * /api/cli-hook endpoint tests — CLI-HOOK-BRIDGE Phase 1A
 * (2026-05-15, JWPK Slice B follow-up).
 *
 * Endpoint contract checks: POST validation, promoted-column extraction,
 * spawn-locality-style rbt_ rejection, GET query shapes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as cliHookPost, GET as cliHookGet } from './+server';
import {
  resetCliHookEventsStoreForTests,
  listCliHookEventsForSession
} from '$lib/server/cliHookEventsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'POST' | 'GET',
  path: string,
  init?: RequestInit
): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...(init ?? {}) });
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

function postBody(path: string, body: unknown, extraHeaders?: Record<string, string>): unknown {
  return eventFor('POST', path, {
    headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
    body: JSON.stringify(body)
  });
}

describe('/api/cli-hook POST', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-hook-route-'));
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

  it('accepts a minimal Claude SessionStart payload', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'sess-1',
        hook_event_name: 'SessionStart',
        source: 'startup'
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: number; source_cli: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.source_cli).toBe('claude-code');
    const rows = listCliHookEventsForSession('sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].hook_event_name).toBe('SessionStart');
  });

  it('extracts promoted columns from a PreToolUse payload', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'sess-2',
        hook_event_name: 'PreToolUse',
        transcript_path: '/tmp/t.jsonl',
        cwd: '/Users/x/proj',
        permission_mode: 'default',
        effort: { level: 'high' },
        tool_name: 'Bash',
        tool_use_id: 'tu_abc',
        tool_input: { command: 'echo hi' }
      })
    );
    expect(response.status).toBe(201);
    const [row] = listCliHookEventsForSession('sess-2');
    expect(row.transcript_path).toBe('/tmp/t.jsonl');
    expect(row.cwd).toBe('/Users/x/proj');
    expect(row.permission_mode).toBe('default');
    expect(row.effort_level).toBe('high');
    expect(row.tool_name).toBe('Bash');
    expect(row.tool_use_id).toBe('tu_abc');
    // Full payload survives in the JSON blob:
    const payload = JSON.parse(row.payload);
    expect(payload.tool_input.command).toBe('echo hi');
  });

  it('honours ?source=<cli> for partitioning', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=codex', {
        session_id: 'sess-codex',
        hook_event_name: 'PreToolUse'
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { source_cli: string };
    expect(body.source_cli).toBe('codex');
  });

  it('rejects missing session_id with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { hook_event_name: 'SessionStart' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects missing hook_event_name with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: 'sess' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects blank session_id with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: '   ', hook_event_name: 'SessionStart' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects a non-object body with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-hook', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(['not', 'an', 'object'])
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects Authorization: Bearer rbt_* with 403 (spawn-locality parity)', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody(
        '/api/cli-hook',
        { session_id: 'sess', hook_event_name: 'SessionStart' },
        { authorization: 'Bearer rbt_remote_token' }
      )
    );
    expect(response.status).toBe(403);
  });

  it('does NOT reject a non-rbt Bearer header', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody(
        '/api/cli-hook',
        { session_id: 'sess', hook_event_name: 'SessionStart' },
        { authorization: 'Bearer admin_other_token' }
      )
    );
    expect(response.status).toBe(201);
  });
});

describe('/api/cli-hook GET', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-hook-get-'));
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

  async function seed(): Promise<void> {
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: 's1', hook_event_name: 'A' })
    );
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: 's1', hook_event_name: 'B' })
    );
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=codex', { session_id: 's2', hook_event_name: 'cx' })
    );
  }

  it('returns events for a specific session newest-first', async () => {
    await seed();
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?session=s1')
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: { hook_event_name: string }[] };
    expect(body.events.map((e) => e.hook_event_name)).toEqual(['B', 'A']);
  });

  it('returns all recent events across sessions when no filter is set', async () => {
    await seed();
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook')
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: { hook_event_name: string }[] };
    expect(body.events).toHaveLength(3);
  });

  it('filters by source when source param is supplied', async () => {
    await seed();
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?source=codex')
    );
    const body = (await response.json()) as { events: { source_cli: string }[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].source_cli).toBe('codex');
  });

  it('rejects a non-integer limit with 400', async () => {
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?limit=abc')
    );
    expect(response.status).toBe(400);
  });

  it('rejects an out-of-range limit with 400', async () => {
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?limit=99999')
    );
    expect(response.status).toBe(400);
  });
});
