import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetTasksStoreForTests, createTask as createJwpkTask } from '$lib/server/tasksStore';
import { createTask as createLegacyTask } from '$lib/server/taskStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'tasks-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyEvent = Parameters<typeof GET>[0] & Parameters<typeof POST>[0];

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (ORIGINAL_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetTasksStoreForTests();
});

function headers(withAuth: boolean): Record<string, string> {
  return withAuth ? { authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` } : {};
}

function getEventFor(urlPath: string, withAuth = true): AnyEvent {
  const url = new URL(`http://localhost${urlPath}`);
  return {
    request: new Request(url.toString(), { headers: headers(withAuth) }),
    params: {},
    url
  } as unknown as AnyEvent;
}

function postEventFor(body: Record<string, unknown>, withAuth = true): AnyEvent {
  const url = new URL('http://localhost/api/tasks');
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers(withAuth) },
      body: JSON.stringify(body)
    }),
    params: {},
    url
  } as unknown as AnyEvent;
}

async function run(handler: typeof GET | typeof POST, event: AnyEvent): Promise<Response> {
  try {
    return (await handler(event as never)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('/api/tasks auth containment', () => {
  it('rejects unauthenticated no-room GET before returning cross-room tasks', async () => {
    createLegacyTask({ id: 'legacy_sensitive_task', subject: 'Sensitive legacy task' });

    const response = await run(GET, getEventFor('/api/tasks', false));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Sensitive legacy task');
  });

  it('allows admin-bearer no-room GET for legacy callers', async () => {
    createLegacyTask({ id: 'legacy_admin_task', subject: 'Admin visible task' });

    const response = await run(GET, getEventFor('/api/tasks'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe('legacy_admin_task');
  });

  it('rejects unauthenticated room-filtered GET before returning room tasks', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });
    createJwpkTask({ id: 'jwpk_room_task', title: 'Sensitive room task', roomId: room.id });

    const response = await run(GET, getEventFor(`/api/tasks?room=${room.id}`, false));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Sensitive room task');
  });

  it('allows authorised room-filtered GET through the room read gate', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });
    createJwpkTask({ id: 'jwpk_room_task', title: 'Readable room task', roomId: room.id });

    const response = await run(GET, getEventFor(`/api/tasks?room=${room.id}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ id: 'jwpk_room_task', title: 'Readable room task' });
  });

  it('makes includeDeleted admin-bearer only', async () => {
    createLegacyTask({ id: 'deleted_sensitive_task', subject: 'Deleted sensitive task', status: 'deleted' });

    const unauth = await run(GET, getEventFor('/api/tasks?includeDeleted=1', false));
    const admin = await run(GET, getEventFor('/api/tasks?includeDeleted=1'));

    expect(unauth.status).toBe(401);
    expect(await unauth.text()).not.toContain('Deleted sensitive task');
    expect(admin.status).toBe(200);
    const body = await admin.json();
    expect(body.tasks.some((task: { id: string }) => task.id === 'deleted_sensitive_task')).toBe(true);
  });

  it('rejects unauthenticated no-room POST before creating standalone tasks', async () => {
    const response = await run(POST, postEventFor({ title: 'Poison standalone task' }, false));

    expect(response.status).toBe(401);
    const adminList = await run(GET, getEventFor('/api/tasks'));
    const body = await adminList.json();
    expect(body.tasks).toHaveLength(0);
  });

  it('allows admin-bearer no-room POST', async () => {
    const response = await run(POST, postEventFor({ title: 'Admin standalone task' }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.task.title).toBe('Admin standalone task');
  });

  it('rejects unauthenticated room-linked POST before creating room tasks', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });

    const response = await run(POST, postEventFor({
      title: 'Poison room task',
      room_id: room.id
    }, false));

    expect(response.status).toBe(401);
    const adminList = await run(GET, getEventFor(`/api/tasks?room=${room.id}`));
    const body = await adminList.json();
    expect(body.tasks).toHaveLength(0);
  });

  it('allows authorised room-linked POST through the room mutation gate', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });

    const response = await run(POST, postEventFor({
      title: 'Authorised room task',
      room_id: room.id
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.task).toMatchObject({ title: 'Authorised room task', roomId: room.id });
  });
});
