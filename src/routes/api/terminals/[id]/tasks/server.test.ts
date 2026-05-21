import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTask, resetTasksStoreForTests } from '\$lib/server/tasksStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string) {
  const url = new URL(`http://localhost/api/terminals/${id}/tasks`);
  return {
    request: new Request(url),
    url,
    params: { id }
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
  resetIdentityDbForTests();
  resetTasksStoreForTests();
});

afterEach(() => {
  resetTasksStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/:id/tasks', () => {
  it('GET returns tasks assigned to terminal', async () => {
    createTask({ id: 'task-1', title: 'T1', assignedTerminalId: 't-1', status: 'todo' });
    createTask({ id: 'task-2', title: 'T2', assignedTerminalId: 't-1', status: 'done' });
    createTask({ id: 'task-3', title: 'T3', assignedTerminalId: 't-2', status: 'todo' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminalId).toBe('t-1');
    expect(body.tasks.length).toBe(2);
    expect(body.tasks.map((t: { id: string }) => t.id)).toContain('task-1');
    expect(body.tasks.map((t: { id: string }) => t.id)).toContain('task-2');
  });

  it('GET returns empty array when no tasks', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([]);
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });
});
