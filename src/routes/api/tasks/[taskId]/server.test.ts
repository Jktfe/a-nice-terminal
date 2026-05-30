import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTask, getTask, _resetTaskStoreForTests } from '\$lib/server/taskStore';
import { GET, PATCH, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'tasks-test-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(taskId: string, method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const url = new URL(`http://localhost/api/tasks/${taskId}`);
  const headers: Record<string, string> = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(url, init),
    url,
    params: { taskId }
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
  _resetTaskStoreForTests();
});

afterEach(() => {
  _resetTaskStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN;
});

describe('/api/tasks/:taskId', () => {
  it('GET returns the task', async () => {
    createTask({ id: 't-1', subject: 'Task one', status: 'pending' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe('t-1');
    expect(body.task.subject).toBe('Task one');
    expect(body.task.status).toBe('pending');
  });

  it('GET 404s for missing task', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('PATCH updates legacy fields', async () => {
    createTask({ id: 't-1', subject: 'Old', status: 'pending', priority: 1 });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      subject: 'New',
      status: 'completed',
      priority: 2
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.subject).toBe('New');
    expect(body.task.status).toBe('completed');
    expect(body.task.priority).toBe(2);
  });

  it('PATCH rejects invalid status', async () => {
    createTask({ id: 't-1', subject: 'Task', status: 'pending' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      status: 'not_a_status'
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('status must be one of');
  });

  it('PATCH rejects non-numeric priority', async () => {
    createTask({ id: 't-1', subject: 'Task', status: 'pending' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      priority: 'high'
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('priority must be a number');
  });

  it('PATCH with JWPK shape routes through tasksStore', async () => {
    createTask({ id: 't-1', subject: 'Task', status: 'pending' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      title: 'JWPK Title',
      status: 'done',
      assigned_to: '@agent'
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.title).toBe('JWPK Title');
    expect(body.task.status).toBe('done');
    expect(body.task.assignedTo).toBe('@agent');
  });

  it('PATCH 404s for missing task', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('ghost', 'PATCH', {
      subject: 'X'
    }));
    expect(res.status).toBe(404);
  });

  it('DELETE soft-deletes the task', async () => {
    createTask({ id: 't-1', subject: 'Task', status: 'pending' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor('t-1', 'DELETE'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const after = getTask('t-1');
    expect(after?.status).toBe('deleted');
  });

  it('DELETE 404s for missing task', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('ghost', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
