/**
 * /api/cli-agents endpoint tests — Phase 5 (2026-05-15).
 *
 * Registry seeded via `registerCliAgentForTests` so we never spawn real
 * codex/pi binaries. Covers GET list, individual GET, DELETE,
 * command-passthrough, and the spawn-locality 403 gate on POST.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as listGet, POST as listPost } from './+server';
import { GET as oneGet, DELETE as oneDelete } from './[handleId]/+server';
import { POST as commandPost } from './[handleId]/command/+server';
import {
  registerCliAgentForTests,
  resetCliAgentRegistryForTests,
  type CliAgentHandle,
  type CliAgentKind
} from '$lib/server/cliAgentRegistry';

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'GET' | 'POST' | 'DELETE', path: string, init?: RequestInit, params?: Record<string, string>): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...(init ?? {}) });
  return { request, params: params ?? {}, url };
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

function fakeHandle(opts: {
  cli: CliAgentKind;
  handleId: string;
  sessionId?: string | null;
  commandResult?: unknown;
  commandError?: string;
}): CliAgentHandle & { __sentCommands: () => unknown[]; __wasStopped: () => boolean } {
  const sentCommandPayloads: unknown[] = [];
  let stopped = false;
  return {
    handleId: opts.handleId,
    cli: opts.cli,
    cwd: null,
    spawnedAtMs: Date.now(),
    getSessionId: () => opts.sessionId ?? null,
    async sendCommand<TResult = unknown>(payload: Record<string, unknown>): Promise<TResult> {
      sentCommandPayloads.push(payload);
      if (opts.commandError) throw new Error(opts.commandError);
      return (opts.commandResult ?? { echoed: payload }) as TResult;
    },
    async stop() {
      stopped = true;
      resetCliAgentRegistryForTests();
    },
    __sentCommands: () => sentCommandPayloads,
    __wasStopped: () => stopped
  };
}

describe('/api/cli-agents endpoints', () => {
  beforeEach(() => resetCliAgentRegistryForTests());
  afterEach(() => resetCliAgentRegistryForTests());

  it('GET /api/cli-agents returns all registered agents', async () => {
    registerCliAgentForTests(fakeHandle({ cli: 'codex', handleId: 'a', sessionId: 'thread-1' }));
    registerCliAgentForTests(fakeHandle({ cli: 'pi', handleId: 'b', sessionId: 'pi-sess-x' }));
    const response = await runHandler(listGet as unknown as AnyHandler, eventFor('GET', '/api/cli-agents'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agents: Array<{ handleId: string; sessionId: string | null }> };
    expect(body.agents.map((a) => a.handleId).sort()).toEqual(['a', 'b']);
    expect(body.agents.find((a) => a.handleId === 'a')?.sessionId).toBe('thread-1');
  });

  it('POST /api/cli-agents rejects Bearer rbt_* with 403 (spawn-locality parity)', async () => {
    const response = await runHandler(
      listPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-agents', {
        headers: { 'content-type': 'application/json', authorization: 'Bearer rbt_test' },
        body: JSON.stringify({ cli: 'codex' })
      })
    );
    expect(response.status).toBe(403);
  });

  it('POST /api/cli-agents rejects unknown cli kind with 400', async () => {
    const response = await runHandler(
      listPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-agents', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cli: 'gemini' })
      })
    );
    expect(response.status).toBe(400);
  });

  it('POST /api/cli-agents with missing cli field returns 400', async () => {
    const response = await runHandler(
      listPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-agents', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    );
    expect(response.status).toBe(400);
  });

  it('GET /api/cli-agents/<handleId> returns the handle when registered', async () => {
    registerCliAgentForTests(fakeHandle({ cli: 'codex', handleId: 'found', sessionId: 'thread-found' }));
    const response = await runHandler(
      oneGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-agents/found', undefined, { handleId: 'found' })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessionId: string };
    expect(body.sessionId).toBe('thread-found');
  });

  it('GET /api/cli-agents/<handleId> returns 404 for unknown id', async () => {
    const response = await runHandler(
      oneGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-agents/phantom', undefined, { handleId: 'phantom' })
    );
    expect(response.status).toBe(404);
  });

  it('DELETE /api/cli-agents/<handleId> stops the bridge', async () => {
    const handle = fakeHandle({ cli: 'pi', handleId: 'stop-me' });
    registerCliAgentForTests(handle);
    const response = await runHandler(
      oneDelete as unknown as AnyHandler,
      eventFor('DELETE', '/api/cli-agents/stop-me', undefined, { handleId: 'stop-me' })
    );
    expect(response.status).toBe(200);
    expect(handle.__wasStopped()).toBe(true);
  });

  it('POST /api/cli-agents/<handleId>/command forwards to bridge.sendCommand', async () => {
    const handle = fakeHandle({
      cli: 'pi',
      handleId: 'send',
      commandResult: { ok: true, tokensBefore: 1234 }
    });
    registerCliAgentForTests(handle);

    const response = await runHandler(
      commandPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-agents/send/command', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'compact', customInstructions: 'keep architecture decisions' })
      }, { handleId: 'send' })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { ok: boolean } };
    expect(body.result.ok).toBe(true);
    const sent = handle.__sentCommands();
    expect(sent).toHaveLength(1);
    expect((sent[0] as Record<string, unknown>).type).toBe('compact');
  });

  it('POST /api/cli-agents/<handleId>/command surfaces bridge errors as 500', async () => {
    registerCliAgentForTests(fakeHandle({
      cli: 'codex',
      handleId: 'err',
      commandError: 'thread/start: invalid model'
    }));
    const response = await runHandler(
      commandPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-agents/err/command', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'thread/start', params: {} })
      }, { handleId: 'err' })
    );
    expect(response.status).toBe(500);
  });

  it('DELETE on unknown handle returns 404 (idempotent semantics)', async () => {
    const response = await runHandler(
      oneDelete as unknown as AnyHandler,
      eventFor('DELETE', '/api/cli-agents/phantom', undefined, { handleId: 'phantom' })
    );
    expect(response.status).toBe(404);
  });
});
