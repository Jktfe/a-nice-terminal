import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { registerCliAgentForTests, resetCliAgentRegistryForTests } from '$lib/server/cliAgentRegistry';
import { POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'cli-prompt-test-admin';

type AnyHandler = (event: unknown) => unknown;

function eventFor(handleId: string, body?: unknown, authenticated = true) {
  const url = new URL(`http://localhost/api/cli-agents/${handleId}/prompt`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers,
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
    roomId: null,
    spawnedAtMs: Date.now(),
    getSessionId: () => `sess-${handleId}`,
    stop: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue({ ok: true }),
    sendPrompt: vi.fn().mockResolvedValue({ threadId: `sess-${handleId}` })
  };
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetCliAgentRegistryForTests();
});

afterEach(() => {
  resetCliAgentRegistryForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/cli-agents/:handleId/prompt', () => {
  it('POST rejects anonymous prompt delivery before touching the agent', async () => {
    const agent = mockAgent('codex-1');
    registerCliAgentForTests(agent);
    const res = await run(POST as unknown as AnyHandler, eventFor('codex-1', { text: 'hello' }, false));
    expect(res.status).toBe(401);
    expect(agent.sendPrompt).not.toHaveBeenCalled();
  });

  it('POST sends a prompt and returns the bridge thread id', async () => {
    const agent = mockAgent('codex-1');
    registerCliAgentForTests(agent);
    const res = await run(POST as unknown as AnyHandler, eventFor('codex-1', { text: 'hello' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.threadId).toBe('sess-codex-1');
    expect(agent.sendPrompt).toHaveBeenCalledWith('hello');
  });

  it('POST 400 for blank prompt text', async () => {
    registerCliAgentForTests(mockAgent('codex-1'));
    const res = await run(POST as unknown as AnyHandler, eventFor('codex-1', { text: '   ' }));
    expect(res.status).toBe(400);
  });

  it('POST 404 for unknown handle after auth succeeds', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('missing', { text: 'hello' }));
    expect(res.status).toBe(404);
  });
});
