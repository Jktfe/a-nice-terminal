import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST as postTasks } from '../src/routes/api/sessions/[id]/tasks/+server.js';
import {
  DELETE as deleteTask,
  PATCH as patchTask,
} from '../src/routes/api/sessions/[id]/tasks/[taskId]/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function routeEvent(roomId: string, body: Record<string, unknown>) {
  return {
    params: { id: roomId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as any;
}

function taskEvent(roomId: string, taskId: string, body: Record<string, unknown> = {}) {
  return {
    params: { id: roomId, taskId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe('task lifecycle provenance and plan links', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-task-lifecycle-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('agent-codex', 'Codex Agent', 'terminal', 'forever', null, null, '{}');
    queries.setHandle('agent-codex', '@evolveantcodex', 'Codex Agent');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('stores task actor, transport source, and plan linkage separately', async () => {
    const response = await postTasks(routeEvent('room-a', {
      title: 'Ship task provenance',
      description: 'Capture the real actor',
      created_by: 'agent-codex',
      created_source: 'cli',
      plan_id: 'cli-task-lifecycle-2026-05-08',
      milestone_id: 'm1-creator-attribution',
      acceptance_id: 'a1-source-vs-actor',
    }));

    expect(response.status).toBe(201);
    const { task } = await response.json();
    expect(task).toMatchObject({
      created_by: '@evolveantcodex',
      created_source: 'cli',
      plan_id: 'cli-task-lifecycle-2026-05-08',
      milestone_id: 'm1-creator-attribution',
      acceptance_id: 'a1-source-vs-actor',
    });
  });

  it('preserves unknown explicit creators instead of collapsing them to cli', async () => {
    const response = await postTasks(routeEvent('room-a', {
      title: 'Remote-created task',
      created_by: '@remote-ant',
      created_source: 'cli',
    }));

    expect(response.status).toBe(201);
    const { task } = await response.json();
    expect(task.created_by).toBe('@remote-ant');
    expect(task.created_source).toBe('cli');
  });

  it('resolves visible task id prefixes for PATCH and DELETE when unambiguous', async () => {
    queries.createTask('HU-FjNf-real-task', 'room-a', '@evolveantcodex', 'Toast lane', null, {
      createdSource: 'cli',
    });

    const patchResponse = await patchTask(taskEvent('room-a', 'HU-FjNf-', { status: 'complete' }));
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json();
    expect(patched.task.id).toBe('HU-FjNf-real-task');
    expect(patched.task.status).toBe('complete');

    const deleteResponse = await deleteTask({
      params: { id: 'room-a', taskId: 'HU-FjNf-' },
    } as any);
    expect(deleteResponse.status).toBe(200);
    expect((queries.getTask('HU-FjNf-real-task') as any).status).toBe('deleted');
  });

  it('returns 409 for ambiguous visible task id prefixes', async () => {
    queries.createTask('sameprefix-alpha', 'room-a', '@a', 'Alpha', null);
    queries.createTask('sameprefix-beta', 'room-a', '@b', 'Beta', null);

    const response = await patchTask(taskEvent('room-a', 'sameprefix', { status: 'complete' }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('ambiguous task id prefix');
    expect(body.matches.map((m: any) => m.id)).toEqual(['sameprefix-alpha', 'sameprefix-beta']);
  });
});
