import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  _resetPlanStoreForTests,
  archivePlan,
  createPlan,
  softDeletePlan
} from '$lib/server/planStore';
import { GET, POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'plans-admin-token';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  _resetPlanStoreForTests();
});

afterEach(() => {
  _resetPlanStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function getReq(search = ''): Parameters<typeof GET>[0] {
  // rv1 data-scoping fix: GET /api/plans is now caller-scoped; these tests
  // assert the full server-wide list, so authenticate as admin-bearer
  // (containment retains full access).
  const url = new URL('http://x/api/plans' + search);
  return {
    url,
    request: new Request(url.toString(), {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    })
  } as Parameters<typeof GET>[0];
}

function postReq(body: unknown, token: string | null = ADMIN_TOKEN): Parameters<typeof POST>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    request: new Request('http://x/api/plans', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

describe('GET /api/plans', () => {
  it('defaults to active plans and supports lifecycle state filters', async () => {
    createPlan({ id: 'p-active', title: 'Active' });
    createPlan({ id: 'p-archived', title: 'Archived' });
    createPlan({ id: 'p-deleted', title: 'Deleted' });
    archivePlan('p-archived');
    softDeletePlan('p-deleted');

    const active = await (await GET(getReq())).json();
    expect(active.plans.map((plan: { id: string }) => plan.id)).toEqual(['p-active']);

    const archived = await (await GET(getReq('?state=archived'))).json();
    expect(archived.plans.map((plan: { id: string }) => plan.id)).toEqual(['p-archived']);

    const deleted = await (await GET(getReq('?state=deleted'))).json();
    expect(deleted.plans.map((plan: { id: string }) => plan.id)).toEqual(['p-deleted']);

    const all = await (await GET(getReq('?state=all'))).json();
    expect(all.plans.map((plan: { id: string }) => plan.id).sort()).toEqual([
      'p-active',
      'p-archived',
      'p-deleted'
    ]);
  });

  it('treats unknown state values as active', async () => {
    createPlan({ id: 'p-active', title: 'Active' });
    createPlan({ id: 'p-archived', title: 'Archived' });
    archivePlan('p-archived');

    const body = await (await GET(getReq('?state=bogus'))).json();

    expect(body.plans.map((plan: { id: string }) => plan.id)).toEqual(['p-active']);
  });
});

describe('POST /api/plans', () => {
  it('requires admin bearer auth', async () => {
    await expect(POST(postReq({ id: 'p1' }, null))).rejects.toMatchObject({ status: 401 });
    await expect(POST(postReq({ id: 'p1' }, 'wrong'))).rejects.toMatchObject({ status: 401 });
    delete process.env.ANT_ADMIN_TOKEN;
    await expect(POST(postReq({ id: 'p1' }, ADMIN_TOKEN))).rejects.toMatchObject({ status: 503 });
  });

  it('creates a plan with optional metadata', async () => {
    const res = await POST(
      postReq({
        id: 'p-created',
        title: 'Created',
        description: 'Plan created from route',
        createdBy: '@codex'
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.plan).toMatchObject({
      id: 'p-created',
      title: 'Created',
      description: 'Plan created from route',
      createdBy: '@codex',
      archivedAtMs: null,
      deletedAtMs: null
    });
  });

  it('rejects invalid bodies and duplicate ids', async () => {
    await expect(POST(postReq(null))).rejects.toMatchObject({ status: 400 });
    await expect(POST(postReq({ id: '   ' }))).rejects.toMatchObject({ status: 400 });

    createPlan({ id: 'dup' });
    await expect(POST(postReq({ id: 'dup' }))).rejects.toMatchObject({ status: 409 });
  });
});
