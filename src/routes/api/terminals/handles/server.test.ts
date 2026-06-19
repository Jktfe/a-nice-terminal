import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { listTerminals } from '$lib/server/ptyClient';
import { GET } from './+server';

vi.mock('$lib/server/ptyClient', () => ({
  listTerminals: vi.fn()
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-handles-test-token';
const listTerminalsMock = vi.mocked(listTerminals);

function eventFor(withAuth = true) {
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return { request: new Request('http://localhost/api/terminals/handles', { headers }) };
}

async function callGet(withAuth = true): Promise<Response> {
  try {
    return (await GET(eventFor(withAuth) as any)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
  listTerminalsMock.mockReset();
  listTerminalsMock.mockResolvedValue([]);
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/terminals/handles', () => {
  it('GET rejects anonymous reads before exposing terminal handle inventory', async () => {
    const res = await callGet(false);
    expect(res.status).toBe(401);
  });

  it('GET returns empty arrays when no terminals exist', async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handles).toEqual([]);
    expect(body.explicit).toEqual([]);
  });

  it('GET returns explicit + derived handles for current tmux sessions', async () => {
    const alpha = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'alpha-terminal' });
    const beta = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'beta-terminal' });
    createTerminalRecord({ sessionId: alpha.id, name: 'alpha', handle: '@alpha' });
    createTerminalRecord({ sessionId: beta.id, name: 'beta', handle: null });
    listTerminalsMock.mockResolvedValue([alpha.id, beta.id]);

    const res = await callGet();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.explicit).toContain('@alpha');
    expect(body.handles).toContain('@alpha');
    expect(body.handles).toContain('@beta');
  });

  it('GET excludes terminal records whose tmux session is gone', async () => {
    const alive = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'alive-terminal' });
    const dead = upsertTerminal({ pid: 4, pid_start: 'p4', name: 'dead-terminal' });
    createTerminalRecord({ sessionId: alive.id, name: 'alive', handle: '@alive' });
    createTerminalRecord({ sessionId: dead.id, name: 'dummyXenoData', handle: null });
    listTerminalsMock.mockResolvedValue([alive.id]);

    const res = await callGet();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handles).toContain('@alive');
    expect(body.handles).not.toContain('@dummyxenodata');
  });
});
