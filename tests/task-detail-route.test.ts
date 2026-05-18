import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('../src/lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { DELETE, PATCH } = await import('../src/routes/api/sessions/[id]/tasks/[taskId]/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(sessionId: string, taskId: string, body: unknown, locals = {}) {
  return {
    params: { id: sessionId, taskId },
    locals,
    request: new Request(`https://ant.test/api/sessions/${sessionId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function deleteEvent(sessionId: string, taskId: string, locals = {}) {
  return { params: { id: sessionId, taskId }, locals } as any;
}

function createSession(id: string, name = id) {
  queries.createSession(id, name, 'chat', 'forever', null, null, '{}');
}

function createTask(sessionId: string, id: string, title: string) {
  queries.createTask(id, sessionId, null, title, null, {});
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

describe('/api/sessions/:id/tasks/:taskId', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-task-detail-'));
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
    createTask('room-1', 'task-1', 'Wire auth');
    createTask('room-2', 'task-2', 'Other task');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('updates task fields, persists, and broadcasts', async () => {
    const response = await PATCH(patchEvent('room-1', 'task-1', {
      status: 'in_progress',
      assigned_to: '@codex',
    }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.task.status).toBe('in_progress');
    expect(json.task.assigned_to).toBe('@codex');
    expect(broadcast).toHaveBeenCalledWith('room-1', {
      type: 'task_updated',
      sessionId: 'room-1',
      task: expect.objectContaining({ status: 'in_progress', assigned_to: '@codex' }),
    });
  });

  it('rejects invalid JSON, non-object bodies, and empty updates', async () => {
    const invalidJson = await PATCH(patchEvent('room-1', 'task-1', '{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await PATCH(patchEvent('room-1', 'task-1', []));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    const emptyUpdate = await PATCH(patchEvent('room-1', 'task-1', {}));
    expect(emptyUpdate.status).toBe(400);
    expect(await emptyUpdate.json()).toEqual({
      error: 'at least one of status, assigned_to, description, or file_refs is required',
    });
  });

  it('returns 404 for unknown tasks and non-existent sessions', async () => {
    const unknownTask = await PATCH(patchEvent('room-1', 'no-such-task', { status: 'done' }));
    expect(unknownTask.status).toBe(404);

    await expectHttpError(() => PATCH(patchEvent('no-such-room', 'task-1', { status: 'done' })), 404);
  });

  it('rejects inactive, cross-room, and read-only callers before updating tasks', async () => {
    await expectHttpError(() => PATCH(patchEvent('archived-room', 'task-1', { status: 'done' })), 410);
    await expectHttpError(() => PATCH(patchEvent('deleted-room', 'task-1', { status: 'done' })), 410);
    await expectHttpError(
      () => PATCH(patchEvent('room-1', 'task-1', { status: 'done' }, { roomScope: { roomId: 'room-2', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => PATCH(patchEvent('room-1', 'task-1', { status: 'done' }, { roomScope: { roomId: 'room-1', kind: 'web' } })),
      403,
    );

    expect(queries.getTask('task-1')).toMatchObject({ status: 'proposed' });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects inactive, cross-room, and read-only callers before deleting tasks', async () => {
    await expectHttpError(() => DELETE(deleteEvent('archived-room', 'task-1')), 410);
    await expectHttpError(() => DELETE(deleteEvent('deleted-room', 'task-1')), 410);
    await expectHttpError(
      () => DELETE(deleteEvent('room-1', 'task-1', { roomScope: { roomId: 'room-2', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => DELETE(deleteEvent('room-1', 'task-1', { roomScope: { roomId: 'room-1', kind: 'web' } })),
      403,
    );

    expect(queries.getTask('task-1')).toMatchObject({ status: 'proposed' });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
