/**
 * Endpoint tests for /api/reclaim-requests/:id/execute — PR-C super-admin
 * reclaim CLI primitive (substrate v0.2 plan, 2026-05-29).
 *
 * Covers: 200 execute (real + dryRun) / 409 already executed / 409 denied
 * / 404 unknown id / 401 wrong bearer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createReclaimRequest,
  denyReclaim,
  resetReclaimRequestsStoreForTests
} from '$lib/server/reclaimRequestsStore';

const ADMIN_TOKEN = 'admin-rcl-exec-tok';
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
  const url = `http://localhost/api/reclaim-requests/${encodeURIComponent(id)}/execute`;
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

describe('POST /api/reclaim-requests/:id/execute', () => {
  it('200 executes a pending identity (NO-OP) request and stamps executor', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { executedByHandle: '@admin' }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.status).toBe('executed');
    expect(body.actions[0].kind).toBe('noop_identity_pending_v02');
  });

  it('200 dryRun leaves the request pending', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, { dryRun: true }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.status).toBe('pending');
    expect(body.actions[0].dryRun).toBe(true);
  });

  it('409 when the request was already executed', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    await POST(makePost(req.reclaimId, {}));
    const res = await callOrUnwrap(() => POST(makePost(req.reclaimId, {})));
    expect(res.status).toBe(409);
  });

  it('409 when the request was already denied', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    denyReclaim({ reclaimId: req.reclaimId, reason: 'no' });
    const res = await callOrUnwrap(() => POST(makePost(req.reclaimId, {})));
    expect(res.status).toBe(409);
  });

  it('404 for an unknown reclaim id', async () => {
    const res = await callOrUnwrap(() => POST(makePost('rcl_missing', {})));
    expect(res.status).toBe(404);
  });

  it('401 rejects wrong admin bearer', async () => {
    const req = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'identity',
      targetId: 'id_x',
      reason: 'soon'
    });
    const res = await callOrUnwrap(() =>
      POST(makePost(req.reclaimId, {}, 'wrong-token'))
    );
    expect(res.status).toBe(401);
  });
});
