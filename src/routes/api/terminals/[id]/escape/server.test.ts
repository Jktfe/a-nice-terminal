import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ptyClient', () => ({
  writeInput: vi.fn()
}));

import { writeInput } from '$lib/server/ptyClient';
import { POST } from './+server';

type AnyHandler = (event: unknown) => unknown;

const TEST_ADMIN_TOKEN = 'test-admin-token-escape';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
});

afterAll(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

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

function eventFor(sessionId: string, opts?: { auth?: boolean }): unknown {
  const url = new URL(`http://localhost/api/terminals/${sessionId}/escape`);
  const headers: Record<string, string> = {};
  if (opts?.auth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    request: new Request(url, { method: 'POST', headers }),
    params: { id: sessionId },
    url
  };
}

describe('POST /api/terminals/:id/escape', () => {
  beforeEach(() => {
    vi.mocked(writeInput).mockClear();
  });

  it('sends exactly one ESC byte to the PTY and returns 202', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, eventFor('t_interrupt'));

    expect(response.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith('t_interrupt', '\x1b');
    expect(await response.json()).toEqual({ ok: true, sessionId: 't_interrupt', sent: 'escape' });
  });

  it('rejects a blank session id', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, eventFor(''));

    expect(response.status).toBe(400);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('returns 401 when no auth is supplied (CVE FIX A 2026-05-19)', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, eventFor('t_interrupt', { auth: false }));

    expect(response.status).toBe(401);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });
});
