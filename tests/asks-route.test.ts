import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET, POST } = await import('../src/routes/api/asks/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/asks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function getEvent(query = '') {
  return {
    url: new URL(`https://ant.test/api/asks${query}`),
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

describe('/api/asks', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-asks-route-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    createSession('room-1', 'Room 1');
    createSession('archived-room', 'Archived Room');
    createSession('deleted-room', 'Deleted Room');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates an ask and returns it', async () => {
    const response = await POST(postEvent({
      session_id: 'room-1',
      title: 'Review the auth middleware',
    }));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.ask.title).toBe('Review the auth middleware');
    expect(json.ask.session_id).toBe('room-1');
  });

  it('rejects invalid JSON, non-object bodies, and missing fields', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await POST(postEvent([]));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    const noSession = await POST(postEvent({ title: 'No session' }));
    expect(noSession.status).toBe(400);
    expect(await noSession.json()).toEqual({ error: 'session_id required' });

    const noContent = await POST(postEvent({ session_id: 'room-1' }));
    expect(noContent.status).toBe(400);
    expect(await noContent.json()).toEqual({ error: 'title or question required' });
  });

  it('rejects explicit inactive session filters and ask creation targets', async () => {
    await expectHttpError(() => GET(getEvent('?session_id=archived-room')), 410);
    await expectHttpError(() => GET(getEvent('?session_id=deleted-room')), 410);

    await expectHttpError(() => POST(postEvent({ session_id: 'archived-room', title: 'Blocked ask' })), 410);
    await expectHttpError(() => POST(postEvent({ session_id: 'deleted-room', title: 'Blocked ask' })), 410);

    expect(queries.listAsks({ sessionId: 'archived-room', statuses: null })).toHaveLength(0);
    expect(queries.listAsks({ sessionId: 'deleted-room', statuses: null })).toHaveLength(0);
  });
});
