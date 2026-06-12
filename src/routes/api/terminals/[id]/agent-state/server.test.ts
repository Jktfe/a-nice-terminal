import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTerminalRecord } from '\$lib/server/terminalRecordsStore';
import { GET } from './+server';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: Buffer.from('/tmp') })
}));

vi.mock('\$lib/server/agentStateReader', () => ({
  findStateForSessionId: vi.fn().mockReturnValue(null),
  findStateForCwd: vi.fn().mockReturnValue({ id: 'snap-1', cwd: '/tmp' }),
  findStateForCwdBasename: vi.fn().mockReturnValue(null)
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string) {
  return {
    request: new Request(`http://localhost/api/terminals/${id}/agent-state`),
    url: new URL(`http://localhost/api/terminals/${id}/agent-state`),
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/:id/agent-state', () => {
  it('GET returns snapshot via cwd lookup', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', agentKind: 'claude-code', tmuxTargetPane: 'pane-1' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot.id).toBe('snap-1');
  });

  it('GET returns null when no agent_kind', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', agentKind: null });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toBeNull();
    expect(body.reason).toBe('agent_kind=null');
  });

  it('GET returns null for unsupported agent_kind', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', agentKind: 'unknown' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toBeNull();
    expect(body.reason).toContain('unsupported');
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });

  it('GET 404 for missing terminal', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing'));
    expect(res.status).toBe(404);
  });
});

describe('tmux binary resolution (rv1/tmux-unify)', () => {
  it('probes pane cwd with the canonical TMUX_BIN from $lib/server/tmuxBin', async () => {
    const { TMUX_BIN } = await import('$lib/server/tmuxBin');
    const { spawnSync } = await import('node:child_process');
    const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>;
    spawnSyncMock.mockClear();
    createTerminalRecord({ sessionId: 't-bin', name: 'Alpha', agentKind: 'claude-code', tmuxTargetPane: 'pane-1' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-bin'));
    expect(res.status).toBe(200);
    expect(spawnSyncMock.mock.calls.length).toBeGreaterThan(0);
    expect(spawnSyncMock.mock.calls[0][0]).toBe(TMUX_BIN);
  });
});
