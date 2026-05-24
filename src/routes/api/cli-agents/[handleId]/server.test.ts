import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { registerCliAgentForTests, resetCliAgentRegistryForTests } from '\$lib/server/cliAgentRegistry';
import { GET, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(handleId: string, method: 'GET' | 'DELETE') {
  const url = new URL(`http://localhost/api/cli-agents/${handleId}`);
  return {
    request: new Request(url, { method }),
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

describe('/api/cli-agents/:handleId', () => {
  it('GET returns agent details', async () => {
    registerCliAgentForTests(mockAgent('codex-1'));
    const res = await run(GET as unknown as AnyHandler, eventFor('codex-1', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handleId).toBe('codex-1');
    expect(body.cli).toBe('codex');
    expect(body.sessionId).toBe('sess-codex-1');
  });

  it('GET 404 for unknown handle', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('DELETE stops the agent', async () => {
    const agent = mockAgent('codex-1');
    registerCliAgentForTests(agent);
    const res = await run(DELETE as unknown as AnyHandler, eventFor('codex-1', 'DELETE'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stopped).toBe(true);
    expect(agent.stop).toHaveBeenCalled();
  });

  it('DELETE 404 for unknown handle', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('missing', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
