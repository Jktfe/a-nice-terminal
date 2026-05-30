/**
 * Endpoint tests for /api/reclaim-requests — PR-C super-admin reclaim
 * CLI primitive (substrate v0.2 plan, 2026-05-29).
 *
 * Covers POST (201 create / 400 missing fields / 400 bad targetKind /
 * 401 wrong bearer / 503 no admin token configured) and GET (200 pending
 * list / 401 wrong bearer).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetReclaimRequestsStoreForTests } from '$lib/server/reclaimRequestsStore';

const ADMIN_TOKEN = 'admin-rcl-tok';
const PREV = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetReclaimRequestsStoreForTests();
});

afterEach(() => {
  resetReclaimRequestsStoreForTests();
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePost(body: unknown, token: string = ADMIN_TOKEN): any {
  const url = 'http://localhost/api/reclaim-requests';
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }),
    params: {},
    url: new URL(url)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGet(token: string = ADMIN_TOKEN): any {
  const url = 'http://localhost/api/reclaim-requests';
  return {
    request: new Request(url, {
      headers: { authorization: `Bearer ${token}` }
    }),
    params: {},
    url: new URL(url)
  };
}

async function callOrUnwrap(invoke: () => unknown): Promise<Response> {
  try {
    return (await invoke()) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

describe('POST /api/reclaim-requests', () => {
  it('201 creates a reclaim request and returns the row', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost({
          targetKind: 'terminal',
          targetId: 't_abc',
          reason: 'stale',
          requesterHandle: '@jamesK'
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.request.reclaimId).toMatch(/^rcl_/);
    expect(body.request.status).toBe('pending');
    expect(body.request.targetKind).toBe('terminal');
  });

  it('201 accepts a diagnostic object and stores it', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost({
          targetKind: 'membership',
          targetId: 'm_x',
          reason: 'dual-bind',
          diagnostic: { rowsObserved: 2 }
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.request.diagnostic.rowsObserved).toBe(2);
  });

  it('400 rejects missing targetKind', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ targetId: 't_x', reason: 'x' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 rejects unknown targetKind', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost({
          targetKind: 'galaxy',
          targetId: 't_x',
          reason: 'x'
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it('400 rejects missing targetId', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost({ targetKind: 'terminal', reason: 'x' }))
    );
    expect(res.status).toBe(400);
  });

  it('400 rejects empty reason', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost({ targetKind: 'terminal', targetId: 't_x', reason: '   ' })
      )
    );
    expect(res.status).toBe(400);
  });

  it('401 rejects wrong admin bearer', async () => {
    const res = await callOrUnwrap(() =>
      POST(
        makePost(
          { targetKind: 'terminal', targetId: 't_x', reason: 'x' },
          'wrong-token'
        )
      )
    );
    expect(res.status).toBe(401);
  });

  it('503 when ANT_ADMIN_TOKEN is unset', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const res = await callOrUnwrap(() =>
      POST(
        makePost({ targetKind: 'terminal', targetId: 't_x', reason: 'x' })
      )
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /api/reclaim-requests', () => {
  it('200 returns pending requests only', async () => {
    await POST(
      makePost({ targetKind: 'terminal', targetId: 't_p1', reason: 'p1' })
    );
    await POST(
      makePost({ targetKind: 'terminal', targetId: 't_p2', reason: 'p2' })
    );
    const res = await callOrUnwrap(() => GET(makeGet()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(2);
    for (const r of body.requests) expect(r.status).toBe('pending');
  });

  it('401 rejects wrong admin bearer', async () => {
    const res = await callOrUnwrap(() => GET(makeGet('wrong-token')));
    expect(res.status).toBe(401);
  });
});
