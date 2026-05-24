import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { registerCliAgentForTests, resetCliAgentRegistryForTests } from '\$lib/server/cliAgentRegistry';
import { POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(handleId: string, body?: unknown) {
  const url = new URL(`http://localhost/api/cli-agents/${handleId}/command`);
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {})
    }),
    url,
    params: { handleId }
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

function mockAgent(handleId: string): Parameters<typeof registerCliAgentForTests>[0] {
  return {
    handleId,
    cli: 'codex',
    cwd: '/tmp',
    spawnedAtMs: Date.now(),
    getSessionId: () => `sess-${handleId}`,
    stop: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue({ ok: true }),
    sendPrompt: vi.fn().mockResolvedValue({ threadId: `sess-${handleId}` })
  };
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetCliAgentRegistryForTests();
});

afterEach(() => {
  resetCliAgentRegistryForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/cli-agents/:handleId/command', () => {
  it('POST sends command and returns result', async () => {
    const agent = mockAgent('codex-1');
    registerCliAgentForTests(agent);
    const res = await run(POST as unknown as AnyHandler, eventFor('codex-1', { method: 'test' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.ok).toBe(true);
    expect(agent.sendCommand).toHaveBeenCalledWith({ method: 'test' });
  });

  it('POST 404 for unknown handle', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('missing', { method: 'test' }));
    expect(res.status).toBe(404);
  });

  it('POST 400 on invalid JSON body', async () => {
    const agent = mockAgent('codex-1');
    registerCliAgentForTests(agent);
    const res = await run(POST as unknown as AnyHandler, {
      request: new Request('http://localhost/api/cli-agents/codex-1/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json'
      }),
      url: new URL('http://localhost/api/cli-agents/codex-1/command'),
      params: { handleId: 'codex-1' }
    });
    expect(res.status).toBe(400);
  });

  it('POST 500 when sendCommand throws', async () => {
    const agent = mockAgent('codex-1');
    agent.sendCommand = vi.fn().mockRejectedValue(new Error('boom'));
    registerCliAgentForTests(agent);
    const res = await run(POST as unknown as AnyHandler, eventFor('codex-1', { method: 'test' }));
    expect(res.status).toBe(500);
  });
});
