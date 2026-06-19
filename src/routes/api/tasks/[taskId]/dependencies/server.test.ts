import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTask, getTask, _resetTaskStoreForTests } from '\$lib/server/taskStore';
import { POST, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'task-dependencies-test-admin';

type AnyHandler = (event: unknown) => unknown;

function eventFor(taskId: string, method: 'POST' | 'DELETE', body?: unknown, authenticated = true) {
  const url = new URL(`http://localhost/api/tasks/${taskId}/dependencies`);
  const headers: Record<string, string> = {};
  if (authenticated) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
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

describe('/api/tasks/:taskId/dependencies', () => {
  it('rejects anonymous POST before adding a dependency edge', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    const res = await run(
      POST as unknown as AnyHandler,
      eventFor('t-a', 'POST', { blockerId: 't-b' }, false)
    );
    expect(res.status).toBe(401);
    expect(getTask('t-a')?.blockedBy).toEqual([]);
    expect(getTask('t-b')?.blocks).toEqual([]);
  });

  it('POST adds a dependency edge', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-b' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.blockedBy).toContain('t-b');
    const blocker = getTask('t-b');
    expect(blocker?.blocks).toContain('t-a');
  });

  it('POST is idempotent for duplicate edges', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-b' }));
    const res2 = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-b' }));
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.task.blockedBy).toEqual(['t-b']);
  });

  it('POST 400 on self-edge', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-a' }));
    expect(res.status).toBe(400);
  });

  it('POST 400 when the new edge would create a cycle', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    createTask({ id: 't-c', subject: 'Task C', status: 'pending' });

    await run(POST as unknown as AnyHandler, eventFor('t-b', 'POST', { blockerId: 't-a' }));
    await run(POST as unknown as AnyHandler, eventFor('t-c', 'POST', { blockerId: 't-b' }));

    const res = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-c' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('cycle');
    expect(getTask('t-a')?.blockedBy).toEqual([]);
    expect(getTask('t-c')?.blocks).toEqual([]);
  });

  it('POST 404 when task is missing', async () => {
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    const res = await run(POST as unknown as AnyHandler, eventFor('missing', 'POST', { blockerId: 't-b' }));
    expect(res.status).toBe(404);
  });

  it('POST 404 when blocker is missing', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 'missing' }));
    expect(res.status).toBe(404);
  });

  it('POST 400 on bad body (non-object)', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', 'not-an-object'));
    expect(res.status).toBe(400);
  });

  it('POST 400 on empty blockerId', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: '' }));
    expect(res.status).toBe(400);
  });

  it('DELETE removes a dependency edge', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-b' }));
    const res = await run(DELETE as unknown as AnyHandler, eventFor('t-a', 'DELETE', { blockerId: 't-b' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.blockedBy).not.toContain('t-b');
    const blocker = getTask('t-b');
    expect(blocker?.blocks).not.toContain('t-a');
  });

  it('rejects anonymous DELETE before removing a dependency edge', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    await run(POST as unknown as AnyHandler, eventFor('t-a', 'POST', { blockerId: 't-b' }));

    const res = await run(
      DELETE as unknown as AnyHandler,
      eventFor('t-a', 'DELETE', { blockerId: 't-b' }, false)
    );
    expect(res.status).toBe(401);
    expect(getTask('t-a')?.blockedBy).toEqual(['t-b']);
    expect(getTask('t-b')?.blocks).toEqual(['t-a']);
  });

  it('DELETE is idempotent when edge does not exist', async () => {
    createTask({ id: 't-a', subject: 'Task A', status: 'pending' });
    createTask({ id: 't-b', subject: 'Task B', status: 'pending' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor('t-a', 'DELETE', { blockerId: 't-b' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.blockedBy).toEqual([]);
  });
});
