/**
 * Endpoint tests for /api/reclaim-requests/:id/deny — PR-C super-admin
 * reclaim CLI primitive (substrate v0.2 plan, 2026-05-29).
 *
 * Covers: 200 deny / 400 missing reason / 409 already decided / 404
 * unknown id / 401 wrong bearer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createReclaimRequest,
  denyReclaim,
  executeReclaim,
  resetReclaimRequestsStoreForTests
} from '$lib/server/reclaimRequestsStore';

const ADMIN_TOKEN = 'admin-rcl-deny-tok';
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
function makePost(id: string, body: unknown, token: string = ADMIN_TOKEN): any {
  const url = `http://localhost/api/reclaim-requests/${encodeURIComponent(id)}/deny`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }),
    params: { id },
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

describe('POST /api/reclaim-requests/:id/deny', () => {
  it('200 denies a pending request', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'orig'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { reason: 'not safe' }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.status).toBe('denied');
    expect(body.request.resultingActions[0].detail).toContain('not safe');
  });

  it('400 rejects empty reason', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'orig'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { reason: '   ' }))
    );
    expect(res.status).toBe(400);
  });

  it('409 when the request was already denied', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'orig'
    });
    denyReclaim({ reclaimId: req.reclaimId, reason: 'first' });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { reason: 'second' }))
    );
    expect(res.status).toBe(409);
  });

  it('409 when the request was already executed', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    executeReclaim({
      reclaimId: req.reclaimId,
      executedByHandle: '@admin'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { reason: 'too late' }))
    );
    expect(res.status).toBe(409);
  });

  it('404 for an unknown reclaim id', async () => {
    const res = await callOrUnwrap(() =>
      POST(makePost('rcl_missing', { reason: 'x' }))
    );
    expect(res.status).toBe(404);
  });

  it('401 rejects wrong admin bearer', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'orig'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { reason: 'x' }, 'wrong-token'))
    );
    expect(res.status).toBe(401);
  });
});
