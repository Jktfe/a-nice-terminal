/**
 * Endpoint tests for /api/reclaim-requests/:id — PR-C super-admin reclaim
 * CLI primitive (substrate v0.2 plan, 2026-05-29).
 *
 * Covers GET single (200 known id / 404 unknown id / 401 wrong bearer).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createReclaimRequest,
  resetReclaimRequestsStoreForTests
} from '$lib/server/reclaimRequestsStore';

const ADMIN_TOKEN = 'admin-rcl-id-tok';
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
function makeGet(id: string, token: string = ADMIN_TOKEN): any {
  const url = `http://localhost/api/reclaim-requests/${encodeURIComponent(id)}`;
  return {
    request: new Request(url, {
      headers: { authorization: `Bearer ${token}` }
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

describe('GET /api/reclaim-requests/:id', () => {
  it('200 returns the row when found', async () => {
    const created = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    const res = await callOrUnwrap(() => GET(makeGet(created.reclaimId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.reclaimId).toBe(created.reclaimId);
  });

  it('404 when no row matches the id', async () => {
    const res = await callOrUnwrap(() => GET(makeGet('rcl_missing')));
    expect(res.status).toBe(404);
  });

  it('401 rejects wrong admin bearer', async () => {
    const created = createReclaimRequest({
      requesterHandle: '@jamesK',
      targetKind: 'terminal',
      targetId: 't_x',
      reason: 'x'
    });
    const res = await callOrUnwrap(() =>
      GET(makeGet(created.reclaimId, 'wrong-token'))
    );
    expect(res.status).toBe(401);
  });
});
