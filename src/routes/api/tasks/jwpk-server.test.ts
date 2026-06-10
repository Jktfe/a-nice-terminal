/**
 * JWPK route tests — JWPK TASKS-SUBSYSTEM (2026-05-16).
 *
 * Covers the JWPK shape that lives alongside the Lane-D shape in
 * /api/tasks/+server.ts. Lane-D tests live in server.test.ts and aren't
 * touched here. Per-test tmpdir DB isolation.
 */

import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { subscribeRoomEvents } from '$lib/server/eventBroadcast';
import { GET as tasksGET, POST as tasksPOST } from './+server';
import { GET as taskGET, PATCH as taskPATCH } from './[taskId]/+server';
import { GET as terminalTasksGET } from '../terminals/[id]/tasks/+server';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;
const ADMIN_TOKEN_FOR_TESTS = 'tasks-jwpk-route-test-admin-token';
const prevAdminToken = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (prevAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = prevAdminToken;
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-jwpk-routes-'));
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
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: { authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` }
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { ...init.headers, 'content-type': 'application/json' };
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

describe('POST /api/tasks (JWPK shape)', () => {
  it('201 on valid JWPK create with title only', async () => {
    const r = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'first jwpk task' }
    });
    expect(r.status).toBe(201);
    const t = r.body.task as Record<string, unknown>;
    expect(t.title).toBe('first jwpk task');
    expect(t.status).toBe('todo');
    expect(typeof t.id).toBe('string');
  });

  it('201 with terminal binding + assignee + room', async () => {
    const room = createChatRoom({ name: 'JWPK task room', whoCreatedIt: '@you' });
    const r = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: {
        title: 'bound everywhere',
        description: 'longform',
        assigned_to: '@claude2',
        assigned_terminal_id: 't_abc',
        room_id: room.id
      }
    });
    expect(r.status).toBe(201);
    const t = r.body.task as Record<string, unknown>;
    expect(t.assignedTo).toBe('@claude2');
    expect(t.assignedTerminalId).toBe('t_abc');
    expect(t.roomId).toBe(room.id);
  });

  it('emits a task_changed realtime event to the bound room on create', async () => {
    // Regression: the JWPK POST branch returns early, so its realtime
    // broadcast is a separate wiring from the Lane-D path. `ant task create`
    // uses this shape — without the emission the room's Tasks panel never
    // refreshes on creation.
    const room = createChatRoom({ name: 'JWPK realtime room', whoCreatedIt: '@you' });
    const events: Record<string, unknown>[] = [];
    const stop = subscribeRoomEvents(room.id, (e) => events.push(e));
    try {
      const r = await call(tasksPOST, {
        method: 'POST',
        url: '/api/tasks',
        body: { title: 'live status', room_id: room.id }
      });
      expect(r.status).toBe(201);
      const taskId = (r.body.task as Record<string, unknown>).id;
      const changed = events.find((e) => e.type === 'task_changed');
      expect(changed).toMatchObject({ type: 'task_changed', action: 'created', taskId });
    } finally {
      stop();
    }
  });

  it('201 with plan binding', async () => {
    const r = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: {
        title: 'planned work',
        plan_id: 'v4-fresh-ant'
      }
    });
    expect(r.status).toBe(201);
    const t = r.body.task as Record<string, unknown>;
    expect(t.planId).toBe('v4-fresh-ant');
  });

  it('400 on empty title', async () => {
    const r = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: '' }
    });
    expect(r.status).toBe(400);
  });

  it('400 on invalid JWPK status', async () => {
    const r = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 't', status: 'nope' }
    });
    expect(r.status).toBe(400);
  });
});

describe('GET /api/tasks (JWPK filters)', () => {
  it('filter by status returns only matching tasks', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'open' } });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'busy', status: 'in_progress' } });
    const r = await call(tasksGET, { url: '/api/tasks?status=in_progress' });
    expect(r.status).toBe(200);
    const titles = (r.body.tasks as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toEqual(['busy']);
  });

  it('filter by assigned returns only matching assignee', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'mine', assigned_to: '@me' } });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'yours', assigned_to: '@you' } });
    const r = await call(tasksGET, { url: '/api/tasks?assigned=@me' });
    expect(r.status).toBe(200);
    expect((r.body.tasks as Array<{ title: string }>).map((t) => t.title)).toEqual(['mine']);
  });

  it('filter by terminal returns only terminal-bound tasks', async () => {
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'bound', assigned_terminal_id: 't_one' } });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'free' } });
    const r = await call(tasksGET, { url: '/api/tasks?terminal=t_one' });
    expect(r.status).toBe(200);
    expect((r.body.tasks as Array<{ title: string }>).map((t) => t.title)).toEqual(['bound']);
  });

  it('400 on invalid status query', async () => {
    const r = await call(tasksGET, { url: '/api/tasks?status=nope' });
    expect(r.status).toBe(400);
  });
});

describe('PATCH /api/tasks/:taskId (JWPK shape)', () => {
  it('PATCH status=done flips to done and stamps completed_at_ms', async () => {
    const created = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'flip me' }
    });
    const id = (created.body.task as { id: string }).id;
    const r = await call(taskPATCH, {
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      params: { taskId: id },
      body: { status: 'done' }
    });
    expect(r.status).toBe(200);
    const t = r.body.task as Record<string, unknown>;
    expect(t.status).toBe('done');
    expect(typeof t.completedAtMs).toBe('number');
  });

  it('PATCH assigned_to updates the JWPK assignee field', async () => {
    const created = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'unassigned' }
    });
    const id = (created.body.task as { id: string }).id;
    const r = await call(taskPATCH, {
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      params: { taskId: id },
      body: { assigned_to: '@codex2' }
    });
    expect(r.status).toBe(200);
    expect((r.body.task as { assignedTo: string }).assignedTo).toBe('@codex2');
  });

  it('PATCH 404 for unknown task', async () => {
    const r = await call(taskPATCH, {
      method: 'PATCH',
      url: '/api/tasks/ghost',
      params: { taskId: 'ghost' },
      body: { status: 'done' }
    });
    expect(r.status).toBe(404);
  });
});

describe('GET /api/terminals/:id/tasks', () => {
  it('returns only tasks with matching assigned_terminal_id', async () => {
    await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'forA', assigned_terminal_id: 't_A' }
    });
    await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'forB', assigned_terminal_id: 't_B' }
    });
    await call(tasksPOST, { method: 'POST', url: '/api/tasks', body: { title: 'free' } });
    const r = await call(terminalTasksGET, {
      url: '/api/terminals/t_A/tasks',
      params: { id: 't_A' }
    });
    expect(r.status).toBe(200);
    expect(r.body.terminalId).toBe('t_A');
    expect((r.body.tasks as Array<{ title: string }>).map((t) => t.title)).toEqual(['forA']);
  });

  it('returns empty array when no tasks bound to that terminal', async () => {
    const r = await call(terminalTasksGET, {
      url: '/api/terminals/t_empty/tasks',
      params: { id: 't_empty' }
    });
    expect(r.status).toBe(200);
    expect(r.body.tasks).toEqual([]);
  });
});

describe('GET /api/tasks/:taskId (round-trip)', () => {
  it('GET after JWPK POST returns the new task', async () => {
    const created = await call(tasksPOST, {
      method: 'POST',
      url: '/api/tasks',
      body: { title: 'fetch me' }
    });
    const id = (created.body.task as { id: string }).id;
    const r = await call(taskGET, { url: `/api/tasks/${id}`, params: { taskId: id } });
    expect(r.status).toBe(200);
    // The GET handler reads via the Lane-D taskStore (which sees the
    // same DB rows but the legacy shape with `subject` populated). We
    // wrote `title` mirrored into `subject` so this resolves.
    const t = r.body.task as Record<string, unknown>;
    expect(t.subject).toBe('fetch me');
  });
});
