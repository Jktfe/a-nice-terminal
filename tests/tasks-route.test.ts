import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('../src/lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { GET, POST } = await import('../src/routes/api/sessions/[id]/tasks/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function getEvent(id: string, locals = {}) {
  return { params: { id }, locals } as any;
}

function postEvent(id: string, body: unknown, locals = {}) {
  return {
    params: { id },
    locals,
    request: new Request(`https://ant.test/api/sessions/${id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function createSession(id: string, name = id) {
  queries.createSession(id, name, 'chat', 'forever', null, null, '{}');
}

async function expectHttpError(action: () => unknown | Promise<unknown>, status: number) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

describe('/api/sessions/:id/tasks', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-tasks-route-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    createSession('room-1', 'Room 1');
    createSession('room-2', 'Room 2');
    createSession('archived-room', 'Archived Room');
    createSession('deleted-room', 'Deleted Room');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
    queries.createTask('task-existing', 'room-1', '@you', 'Existing task', null, {});
    queries.createTask('task-other', 'room-2', '@you', 'Other task', null, {});
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists tasks scoped to the requested active session', async () => {
    const response = await GET(getEvent('room-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tasks: [
        expect.objectContaining({
          id: 'task-existing',
          session_id: 'room-1',
          title: 'Existing task',
        }),
      ],
    });
  });

  it('rejects missing, inactive, and cross-room scoped task reads', async () => {
    await expectHttpError(() => GET(getEvent('missing-room')), 404);
    await expectHttpError(() => GET(getEvent('archived-room')), 410);
    await expectHttpError(() => GET(getEvent('deleted-room')), 410);
    await expectHttpError(
      () => GET(getEvent('room-1', { roomScope: { roomId: 'room-2', kind: 'web' } })),
      403,
    );
  });

  it('creates a task, persists it, and broadcasts', async () => {
    const response = await POST(postEvent('room-1', {
      title: '  Wire up auth middleware  ',
      description: 'Add Clerk middleware to the API routes',
    }));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.task).toBeDefined();
    expect(json.task.title).toBe('Wire up auth middleware');
    expect(json.task.description).toBe('Add Clerk middleware to the API routes');
    expect(json.task.session_id).toBe('room-1');
    expect(broadcast).toHaveBeenCalledWith('room-1', {
      type: 'task_created',
      sessionId: 'room-1',
      task: expect.objectContaining({ title: 'Wire up auth middleware' }),
    });
  });

  it('rejects invalid JSON, non-object bodies, missing sessions, and missing titles', async () => {
    const invalidJson = await POST(postEvent('room-1', '{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await POST(postEvent('room-1', []));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    const missing = await POST(postEvent('no-such-room', { title: 'Nope' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Session not found' });

    const noTitle = await POST(postEvent('room-1', {}));
    expect(noTitle.status).toBe(400);
    expect(await noTitle.json()).toEqual({ error: 'title required' });

    const emptyTitle = await POST(postEvent('room-1', { title: '   ' }));
    expect(emptyTitle.status).toBe(400);
    expect(await emptyTitle.json()).toEqual({ error: 'title required' });
  });

  it('rejects inactive, cross-room, and read-only callers before task creation', async () => {
    const payload = { title: 'Blocked task' };

    const archived = await POST(postEvent('archived-room', payload));
    expect(archived.status).toBe(410);
    expect(await archived.json()).toEqual({ error: 'Session is inactive' });

    const deleted = await POST(postEvent('deleted-room', payload));
    expect(deleted.status).toBe(410);
    expect(await deleted.json()).toEqual({ error: 'Session is inactive' });

    await expectHttpError(
      () => POST(postEvent('room-1', payload, { roomScope: { roomId: 'room-2', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => POST(postEvent('room-1', payload, { roomScope: { roomId: 'room-1', kind: 'web' } })),
      403,
    );

    expect(queries.listTasks('room-1')).toEqual([
      expect.objectContaining({ id: 'task-existing' }),
    ]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
