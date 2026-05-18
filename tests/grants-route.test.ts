import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET, POST } = await import('../src/routes/api/sessions/[id]/grants/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(sessionId: string, body: unknown) {
  return {
    params: { id: sessionId },
    url: new URL(`https://ant.test/api/sessions/${sessionId}/grants`),
    request: new Request(`https://ant.test/api/sessions/${sessionId}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function getEvent(sessionId: string) {
  return {
    params: { id: sessionId },
    url: new URL(`https://ant.test/api/sessions/${sessionId}/grants`),
  } as any;
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

function createSession(id: string, name = id) {
  queries.createSession(id, name, 'chat', 'forever', null, null, '{}');
}

describe('/api/sessions/:id/grants', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-grants-route-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    createSession('room-1', 'Room 1');
    createSession('archived-room', 'Archived Room');
    createSession('deleted-room', 'Deleted Room');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a consent grant and returns it', async () => {
    const response = await POST(postEvent('room-1', {
      topic: 'file-read',
      granted_to: '@codex',
      duration: '30m',
    }));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.grant.topic).toBe('file-read');
    expect(json.grant.granted_to).toBe('@codex');
    expect(json.grant.session_id).toBe('room-1');
    expect(json.grant.status).toBe('active');
  });

  it('rejects invalid JSON, non-object bodies, and missing fields', async () => {
    const invalidJson = await POST(postEvent('room-1', '{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await POST(postEvent('room-1', []));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    const noTopic = await POST(postEvent('room-1', { granted_to: '@codex' }));
    expect(noTopic.status).toBe(400);
    expect(await noTopic.json()).toEqual({ error: 'topic is required' });

    const noGrantee = await POST(postEvent('room-1', { topic: 'file-read' }));
    expect(noGrantee.status).toBe(400);
    expect(await noGrantee.json()).toEqual({ error: 'granted_to is required' });
  });

  it('rejects missing, inactive, and non-chat sessions before list or create', async () => {
    for (const [sessionId, status] of [
      ['missing-room', 404],
      ['archived-room', 410],
      ['deleted-room', 410],
      ['terminal-a', 400],
    ] as const) {
      await expectHttpError(() => GET(getEvent(sessionId)), status);
      await expectHttpError(
        () => POST(postEvent(sessionId, { topic: 'file-read', granted_to: '@codex' })),
        status,
      );
    }
  });
});
