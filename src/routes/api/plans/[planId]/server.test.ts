import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  _resetPlanStoreForTests,
  archivePlan,
  createPlan,
  getPlan,
  softDeletePlan
} from '$lib/server/planStore';
import { _resetTaskStoreForTests, createTask } from '$lib/server/taskStore';
import { GET, PATCH } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'plan-detail-admin-token';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
});

afterEach(() => {
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function getReq(planId: string): Parameters<typeof GET>[0] {
  // rv1 data-scoping fix: GET /api/plans/:planId is now caller-scoped; admin
  // -bearer retains full access (containment), which is what these tests need.
  return {
    params: { planId },
    request: new Request('http://x/api/plans/' + encodeURIComponent(planId), {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    })
  } as Parameters<typeof GET>[0];
}

function patchReq(planId: string, body: unknown, token: string | null = ADMIN_TOKEN): Parameters<typeof PATCH>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    params: { planId },
    request: new Request('http://x/api/plans/' + encodeURIComponent(planId), {
      method: 'PATCH',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  } as Parameters<typeof PATCH>[0];
}

describe('GET /api/plans/:planId', () => {
  it('returns a single plan and rejects missing ids', async () => {
    createPlan({ id: 'p1', title: 'Plan One', description: 'Tracked work' });

    const res = await GET(getReq('p1'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plan).toMatchObject({
      id: 'p1',
      title: 'Plan One',
      description: 'Tracked work'
    });
    await expect(GET(getReq(''))).rejects.toMatchObject({ status: 400 });
    await expect(GET(getReq('missing'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('PATCH /api/plans/:planId', () => {
  it('requires admin auth for mutations', async () => {
    createPlan({ id: 'p1' });

    await expect(PATCH(patchReq('p1', { title: 'No auth' }, null))).rejects.toMatchObject({
      status: 401
    });
    await expect(PATCH(patchReq('p1', { title: 'Wrong auth' }, 'wrong'))).rejects.toMatchObject({
      status: 401
    });
    // CVE-C-cascade contract change (commit c233595 + this route's
    // requirePlanMutationAuth, post-2026-05-19): admin-not-configured is
    // now subsumed into the 401-unauthenticated outcome. From the client's
    // perspective, "service has no admin token" and "you sent no creds"
    // both mean "you can't do this" — the leaky 503 distinction is gone.
    delete process.env.ANT_ADMIN_TOKEN;
    await expect(PATCH(patchReq('p1', { title: 'No config' }))).rejects.toMatchObject({
      status: 401
    });
  });

  it('patches plan metadata and validates patch shape', async () => {
    createPlan({ id: 'p1', title: 'Old', description: 'Keep' });

    const res = await PATCH(patchReq('p1', { title: 'New', description: null }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plan).toMatchObject({
      id: 'p1',
      title: 'New',
      description: null
    });
    await expect(PATCH(patchReq('p1', {}))).rejects.toMatchObject({ status: 400 });
    await expect(PATCH(patchReq('p1', { title: 123 }))).rejects.toMatchObject({ status: 400 });
    await expect(PATCH(patchReq('missing', { title: 'Nope' }))).rejects.toMatchObject({
      status: 404
    });
  });

  it('applies lifecycle actions and rejects invalid actions', async () => {
    createPlan({ id: 'p1' });

    const archived = await (await PATCH(patchReq('p1', { action: 'archive' }))).json();
    expect(archived.plan.archivedAtMs).toEqual(expect.any(Number));

    const restoredArchive = await (await PATCH(patchReq('p1', { action: 'unarchive' }))).json();
    expect(restoredArchive.plan.archivedAtMs).toBeNull();

    const deleted = await (await PATCH(patchReq('p1', { action: 'delete' }))).json();
    expect(deleted.plan.deletedAtMs).toEqual(expect.any(Number));

    const restoredDelete = await (await PATCH(patchReq('p1', { action: 'restore' }))).json();
    expect(restoredDelete.plan.deletedAtMs).toBeNull();

    await expect(PATCH(patchReq('p1', { action: 'explode' }))).rejects.toMatchObject({
      status: 400
    });
  });

  it('materialises legacy implicit plans on lifecycle writes', async () => {
    createTask({ id: 't-legacy', subject: 'Legacy task', planId: 'legacy-plan' });
    _resetPlanStoreForTests();
    expect(getPlan('legacy-plan')).toBeNull();

    const res = await PATCH(patchReq('legacy-plan', { action: 'archive' }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plan).toMatchObject({
      id: 'legacy-plan',
      archivedAtMs: expect.any(Number)
    });
  });

  it('keeps random unknown plans as 404 on lifecycle writes', async () => {
    createPlan({ id: 'archived' });
    archivePlan('archived');
    createPlan({ id: 'deleted' });
    softDeletePlan('deleted');

    await expect(PATCH(patchReq('not-referenced', { action: 'archive' }))).rejects.toMatchObject({
      status: 404
    });
  });
});
