import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET, PATCH } = await import('../src/routes/api/sessions/[id]/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(sessionId: string, body: unknown) {
  return {
    params: { id: sessionId },
    request: new Request(`https://ant.test/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function getEvent(sessionId: string, locals = {}) {
  return {
    params: { id: sessionId },
    locals,
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

describe('/api/sessions/:id', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-patch-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    createSession('room-1', 'Room 1');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('renames a session and returns the updated record', async () => {
    const response = await PATCH(patchEvent('room-1', { name: 'Renamed Room' }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.name).toBe('Renamed Room');
  });

  it('enforces same-room scoped access for session detail reads', async () => {
    createSession('room-2', 'Room 2');
    createSession('archived-room', 'Archived Room');
    createSession('deleted-room', 'Deleted Room');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');

    const sameRoom = await GET(getEvent('room-1', { roomScope: { roomId: 'room-1', kind: 'web' } }));
    expect(sameRoom.status).toBe(200);
    expect(await sameRoom.json()).toMatchObject({ id: 'room-1', name: 'Room 1' });

    await expectHttpError(() => GET(getEvent('room-1', { roomScope: { roomId: 'room-2', kind: 'web' } })), 403);
    await expectHttpError(() => GET(getEvent('missing-room')), 404);
    await expectHttpError(() => GET(getEvent('archived-room')), 410);
    await expectHttpError(() => GET(getEvent('deleted-room')), 410);
  });

  it('rejects invalid JSON, non-object bodies, and missing sessions', async () => {
    const invalidJson = await PATCH(patchEvent('room-1', '{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await PATCH(patchEvent('room-1', []));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    try {
      await PATCH(patchEvent('no-such-room', { name: 'Nope' }));
      throw new Error('Expected 404');
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
  });

  it('rejects empty session names', async () => {
    const empty = await PATCH(patchEvent('room-1', { name: '   ' }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'Session name is required' });
  });
});
