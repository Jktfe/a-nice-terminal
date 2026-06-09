/**
 * /api/terminals/recover endpoint tests. Mocks the recovery core so no real
 * tmux is invoked — the endpoint's job is auth/validation + wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/sessionRecovery', () => ({ recoverSessions: vi.fn() }));

import { POST as recoverPost } from './+server';
import { recoverSessions } from '$lib/server/sessionRecovery';

type AnyHandler = (event: unknown) => unknown;

function eventFor(body: unknown, headers: Record<string, string> = {}): unknown {
  const request = new Request('http://localhost/api/terminals/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { request };
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

describe('/api/terminals/recover', () => {
  beforeEach(() => {
    vi.mocked(recoverSessions).mockReset();
    vi.mocked(recoverSessions).mockImplementation(async (ids, opts) =>
      (ids ?? []).map((sessionId) => ({
        sessionId, name: sessionId, command: 'claude',
        action: opts?.dryRun ? 'planned' as const : 'spawned' as const,
        agentLaunched: !opts?.dryRun
      }))
    );
  });

  it('rejects Bearer rbt_* with 403', async () => {
    const res = await runHandler(
      recoverPost as unknown as AnyHandler,
      eventFor({ sessionIds: ['t1'] }, { authorization: 'Bearer rbt_remote' })
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(recoverSessions)).not.toHaveBeenCalled();
  });

  it('400s on an empty sessionIds array', async () => {
    const res = await runHandler(recoverPost as unknown as AnyHandler, eventFor({ sessionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('recovers and defaults launchAgents to true', async () => {
    const res = await runHandler(
      recoverPost as unknown as AnyHandler,
      eventFor({ sessionIds: ['t1', 't2'] })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recovered: Array<{ action: string }> };
    expect(body.recovered).toHaveLength(2);
    expect(vi.mocked(recoverSessions)).toHaveBeenCalledWith(['t1', 't2'], {
      resume: false, launchAgent: true, dryRun: false, renameBySessionId: {}
    });
  });

  it('passes resume + dryRun through and honours launchAgents:false', async () => {
    await runHandler(
      recoverPost as unknown as AnyHandler,
      eventFor({ sessionIds: ['t1'], resume: true, dryRun: true, launchAgents: false })
    );
    expect(vi.mocked(recoverSessions)).toHaveBeenCalledWith(['t1'], {
      resume: true, launchAgent: false, dryRun: true, renameBySessionId: {}
    });
  });

  it('passes validated recovery renames through to the recovery core', async () => {
    await runHandler(
      recoverPost as unknown as AnyHandler,
      eventFor({ sessionIds: ['t1'], renames: { t1: 'Recovered Claude' } })
    );
    expect(vi.mocked(recoverSessions)).toHaveBeenCalledWith(['t1'], {
      resume: false,
      launchAgent: true,
      dryRun: false,
      renameBySessionId: { t1: 'Recovered Claude' }
    });
  });

  it('rejects rename keys outside the selected session set', async () => {
    const res = await runHandler(
      recoverPost as unknown as AnyHandler,
      eventFor({ sessionIds: ['t1'], renames: { other: 'Wrong' } })
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(recoverSessions)).not.toHaveBeenCalled();
  });
});
