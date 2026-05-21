/**
 * Lane-D S1.1 — route-unit tests for the task/plan API contract.
 * Pins the 5 +server.ts handlers (status codes + JSON shapes) against
 * drift while S2 FE builds against these routes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '$lib/server/db';
import { GET as tasksGET, POST as tasksPOST } from './+server';
import { GET as taskGET, PATCH as taskPATCH, DELETE as taskDELETE } from './[taskId]/+server';
import { POST as depPOST, DELETE as depDELETE } from './[taskId]/dependencies/+server';
import { GET as completionsGET } from '../plans/completions/+server';
import { GET as planTasksGET } from '../plans/[planId]/tasks/+server';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-task-routes-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

type Result = { status: number; body: Record<string, unknown> };

async function call<E>(
  handler: (event: E) => unknown,
  opts: { method?: string; url: string; params?: Record<string, string>; body?: unknown }
): Promise<Result> {
  const init: RequestInit = { method: opts.method ?? 'GET' };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
  const url = new URL(`http://localhost${opts.url}`);
  const event = { request: new Request(url, init), params: opts.params ?? {}, url } as unknown as E;
  try {
    const res = (await handler(event)) as Response;
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { status: thrown.status, body: await thrown.json().catch(() => ({})) };
    }
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return { status: f.status, body: f.body ?? {} };
    throw thrown;
  }
}

describe('POST /api/tasks', () => {
  it('201 on valid create', async () => {
    const r = await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'r1', subject: 's' } });
    expect(r.status).toBe(201);
    expect((r.body.task as { id: string }).id).toBe('r1');
  });

  it('400 when id missing', async () => {
    const r = await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { subject: 's' } });
    expect(r.status).toBe(400);
  });

  it('400 when subject missing', async () => {
    const r = await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'x' } });
    expect(r.status).toBe(400);
  });

  it('400 on invalid status', async () => {
    const r = await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'x', subject: 's', status: 'nope' } });
    expect(r.status).toBe(400);
  });

  it('409 on duplicate id', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'dup', subject: 's' } });
    const r = await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'dup', subject: 's2' } });
    expect(r.status).toBe(409);
  });
});

describe('GET /api/tasks', () => {
  it('returns tasks array', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'g1', subject: 's' } });
    const r = await call(tasksGET, { url: '/api/tasks' });
    expect(r.status).toBe(200);
    expect((r.body.tasks as unknown[]).length).toBe(1);
  });
});

describe('/api/tasks/:taskId', () => {
  it('GET 404 unknown, 200 known', async () => {
    expect((await call(taskGET, { url: '/api/tasks/none', params: { taskId: 'none' } })).status).toBe(404);
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'k', subject: 's' } });
    expect((await call(taskGET, { url: '/api/tasks/k', params: { taskId: 'k' } })).status).toBe(200);
  });

  it('PATCH 404 unknown, 400 bad status, 200 valid', async () => {
    expect((await call(taskPATCH, { method: 'PATCH', url: '/api/tasks/none', params: { taskId: 'none' }, body: {} })).status).toBe(404);
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'p', subject: 's' } });
    expect((await call(taskPATCH, { method: 'PATCH', url: '/api/tasks/p', params: { taskId: 'p' }, body: { status: 'bad' } })).status).toBe(400);
    const ok = await call(taskPATCH, { method: 'PATCH', url: '/api/tasks/p', params: { taskId: 'p' }, body: { status: 'completed' } });
    expect(ok.status).toBe(200);
    expect((ok.body.task as { status: string }).status).toBe('completed');
  });

  it('DELETE 404 unknown, 200 soft-delete', async () => {
    expect((await call(taskDELETE, { method: 'DELETE', url: '/api/tasks/none', params: { taskId: 'none' } })).status).toBe(404);
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'd', subject: 's' } });
    const r = await call(taskDELETE, { method: 'DELETE', url: '/api/tasks/d', params: { taskId: 'd' } });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('/api/tasks/:taskId/dependencies', () => {
  beforeEach(async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'a', subject: 'a' } });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'b', subject: 'b' } });
  });

  it('400 missing blockerId', async () => {
    const r = await call(depPOST, { method: 'POST', url: '/api/tasks/a/dependencies', params: { taskId: 'a' }, body: {} });
    expect(r.status).toBe(400);
  });

  it('400 self-edge', async () => {
    const r = await call(depPOST, { method: 'POST', url: '/api/tasks/a/dependencies', params: { taskId: 'a' }, body: { blockerId: 'a' } });
    expect(r.status).toBe(400);
  });

  it('404 missing referenced task', async () => {
    const r = await call(depPOST, { method: 'POST', url: '/api/tasks/a/dependencies', params: { taskId: 'a' }, body: { blockerId: 'ghost' } });
    expect(r.status).toBe(404);
  });

  it('200 add then DELETE mirrors', async () => {
    const add = await call(depPOST, { method: 'POST', url: '/api/tasks/a/dependencies', params: { taskId: 'a' }, body: { blockerId: 'b' } });
    expect(add.status).toBe(200);
    expect((add.body.task as { blockedBy: string[] }).blockedBy).toEqual(['b']);
    const del = await call(depDELETE, { method: 'DELETE', url: '/api/tasks/a/dependencies', params: { taskId: 'a' }, body: { blockerId: 'b' } });
    expect(del.status).toBe(200);
    expect((del.body.task as { blockedBy: string[] }).blockedBy).toEqual([]);
  });
});

describe('GET /api/plans/completions', () => {
  it('excludes standalone, includes plan donut', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 's', subject: 's' } });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 'pc', subject: 's', planId: 'PL', status: 'completed' } });
    const r = await call(completionsGET, { url: '/api/plans/completions' });
    expect(r.status).toBe(200);
    expect(r.body.plans).toEqual([{ planId: 'PL', title: null, total: 1, completed: 1, pct: 1 }]);
  });
});

describe('GET /api/plans/:planId/tasks', () => {
  it('returns planId, completion, priority-ordered tasks', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 't-lo', subject: 'lo', planId: 'PX', priority: 2 } });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { id: 't-hi', subject: 'hi', planId: 'PX', priority: 1 } });
    const r = await call(planTasksGET, { url: '/api/plans/PX/tasks', params: { planId: 'PX' } });
    expect(r.status).toBe(200);
    expect(r.body.planId).toBe('PX');
    expect((r.body.tasks as { id: string }[]).map((t) => t.id)).toEqual(['t-hi', 't-lo']);
    expect((r.body.completion as { total: number }).total).toBe(2);
  });
});
