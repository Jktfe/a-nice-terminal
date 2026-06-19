import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { createTerminalRecord, getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import { PATCH } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function seedLiveTerminal(id: string, agentKind: string | null): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminals (id, pid, pid_start, name, agent_kind, source, meta, created_at, updated_at)
       VALUES (?, 1, 'test', ?, ?, 'test', '{}', 1, 1)`
    )
    .run(id, `live-${id}`, agentKind);
}

function eventFor(id: string, body: unknown, headers: Record<string, string> = {}): unknown {
  const url = new URL(`http://localhost/api/terminals/${id}/cli`);
  return {
    request: new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    url,
    params: { id }
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
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

function adminHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-admin-token' };
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = 'test-admin-token';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('PATCH /api/terminals/:id/cli', () => {
  it('requires admin or operator auth', async () => {
    createTerminalRecord({ sessionId: 't-cli-auth', name: 'CLI auth', agentKind: 'claude' });
    seedLiveTerminal('t-cli-auth', 'claude');

    const response = await run(PATCH as unknown as AnyHandler, eventFor('t-cli-auth', { cli: 'agy' }));

    expect(response.status).toBe(401);
  });

  it('sets opaque CLI slugs and syncs terminals plus terminal_records', async () => {
    createTerminalRecord({ sessionId: 't-cli-sync', name: 'CLI sync', agentKind: 'claude' });
    seedLiveTerminal('t-cli-sync', 'claude');

    const response = await run(
      PATCH as unknown as AnyHandler,
      eventFor('t-cli-sync', { cli: ' agy ' }, adminHeaders())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sessionId: 't-cli-sync',
      agentKind: 'agy'
    });
    expect(getTerminalById('t-cli-sync')?.agent_kind).toBe('agy');
    expect(getTerminalRecord('t-cli-sync')?.agent_kind).toBe('agy');
  });

  it('clears the CLI value in both terminal stores', async () => {
    createTerminalRecord({ sessionId: 't-cli-clear', name: 'CLI clear', agentKind: 'codex' });
    seedLiveTerminal('t-cli-clear', 'codex');

    const response = await run(
      PATCH as unknown as AnyHandler,
      eventFor('t-cli-clear', { cli: null }, adminHeaders())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sessionId: 't-cli-clear',
      agentKind: null
    });
    expect(getTerminalById('t-cli-clear')?.agent_kind).toBeNull();
    expect(getTerminalRecord('t-cli-clear')?.agent_kind).toBeNull();
  });
});
