import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, PATCH } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createTask as createJwpkTask, resetTasksStoreForTests } from '$lib/server/tasksStore';
import { createTask as createLegacyTask, getTask as getLegacyTask } from '$lib/server/taskStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'task-detail-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyEvent =
  & Parameters<typeof GET>[0]
  & Parameters<typeof PATCH>[0]
  & Parameters<typeof DELETE>[0];

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

function eventFor(
  method: 'GET' | 'PATCH' | 'DELETE',
  taskId: string,
  body?: Record<string, unknown>,
  withAuth = true
): AnyEvent {
  const url = new URL(`http://localhost/api/tasks/${encodeURIComponent(taskId)}`);
  return {
    request: new Request(url.toString(), {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers(withAuth)
      },
      body: body ? JSON.stringify(body) : undefined
    }),
    params: { taskId },
    url
  } as unknown as AnyEvent;
}

async function run(
  handler: typeof GET | typeof PATCH | typeof DELETE,
  event: AnyEvent
): Promise<Response> {
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

describe('/api/tasks/:taskId auth containment', () => {
  it('rejects unauthenticated standalone GET before returning task detail', async () => {
    createLegacyTask({ id: 'standalone_sensitive', subject: 'Standalone sensitive detail' });

    const response = await run(GET, eventFor('GET', 'standalone_sensitive', undefined, false));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Standalone sensitive detail');
  });

  it('allows admin-bearer standalone GET', async () => {
    createLegacyTask({ id: 'standalone_admin', subject: 'Admin detail' });

    const response = await run(GET, eventFor('GET', 'standalone_admin'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.task).toMatchObject({ id: 'standalone_admin', subject: 'Admin detail' });
  });

  it('rejects unauthenticated room-linked GET before returning task detail', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });
    createJwpkTask({ id: 'room_sensitive', title: 'Room sensitive detail', roomId: room.id });

    const response = await run(GET, eventFor('GET', 'room_sensitive', undefined, false));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Room sensitive detail');
  });

  it('allows admin-bearer room-linked GET through the read gate', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });
    createJwpkTask({ id: 'room_admin', title: 'Room admin detail', roomId: room.id });

    const response = await run(GET, eventFor('GET', 'room_admin'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.task).toMatchObject({ id: 'room_admin', subject: 'Room admin detail' });
  });

  it('rejects unauthenticated standalone PATCH before mutating', async () => {
    createLegacyTask({ id: 'standalone_patch', subject: 'Patch me' });

    const response = await run(
      PATCH,
      eventFor('PATCH', 'standalone_patch', { status: 'completed' }, false)
    );

    expect(response.status).toBe(401);
    expect(getLegacyTask('standalone_patch')?.status).toBe('pending');
  });

  it('allows admin-bearer standalone PATCH', async () => {
    createLegacyTask({ id: 'standalone_patch_admin', subject: 'Patch me' });

    const response = await run(
      PATCH,
      eventFor('PATCH', 'standalone_patch_admin', { status: 'completed' })
    );

    expect(response.status).toBe(200);
    expect(getLegacyTask('standalone_patch_admin')?.status).toBe('completed');
  });

  it('rejects unauthenticated room-linked PATCH before mutating', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });
    createJwpkTask({ id: 'room_patch', title: 'Patch room task', roomId: room.id });

    const response = await run(PATCH, eventFor('PATCH', 'room_patch', { status: 'done' }, false));

    expect(response.status).toBe(401);
    expect(getLegacyTask('room_patch')?.status).toBe('pending');
  });

  it('allows admin-bearer room-linked PATCH through the mutation gate', async () => {
    const room = createChatRoom({ name: 'task room', whoCreatedIt: '@you' });
    createJwpkTask({ id: 'room_patch_admin', title: 'Patch room task', roomId: room.id });

    const response = await run(PATCH, eventFor('PATCH', 'room_patch_admin', { status: 'done' }));

    expect(response.status).toBe(200);
    expect(getLegacyTask('room_patch_admin')?.status).toBe('completed');
  });

  it('rejects unauthenticated DELETE before soft-deleting', async () => {
    createLegacyTask({ id: 'standalone_delete', subject: 'Delete me' });

    const response = await run(DELETE, eventFor('DELETE', 'standalone_delete', undefined, false));

    expect(response.status).toBe(401);
    expect(getLegacyTask('standalone_delete')?.status).toBe('pending');
  });

  it('allows admin-bearer DELETE', async () => {
    createLegacyTask({ id: 'standalone_delete_admin', subject: 'Delete me' });

    const response = await run(DELETE, eventFor('DELETE', 'standalone_delete_admin'));

    expect(response.status).toBe(200);
    expect(getLegacyTask('standalone_delete_admin')?.status).toBe('deleted');
  });
});
