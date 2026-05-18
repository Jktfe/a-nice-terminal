import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { DELETE, GET, PATCH } = await import('../src/routes/api/asks/[id]/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(askId: string, body: unknown) {
  return {
    params: { id: askId },
    request: new Request(`https://ant.test/api/asks/${askId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function getEvent(askId: string) {
  return {
    params: { id: askId },
    url: new URL(`https://ant.test/api/asks/${askId}`),
  } as any;
}

function deleteEvent(askId: string) {
  return {
    params: { id: askId },
    request: new Request(`https://ant.test/api/asks/${askId}`, { method: 'DELETE' }),
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

function createAsk(id: string, sessionId: string, title: string) {
  queries.createAsk(id, sessionId, null, title, '', null, 'open', 'room', 'room', 'normal', null, 0, 0, '{"source":"test"}');
}

describe('/api/asks/:id', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-ask-detail-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    createSession('room-1', 'Room 1');
    createSession('archived-room', 'Archived Room');
    createSession('deleted-room', 'Deleted Room');
    createAsk('ask-1', 'room-1', 'Review middleware');
    createAsk('ask-archived', 'archived-room', 'Archived ask');
    createAsk('ask-deleted', 'deleted-room', 'Deleted ask');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('updates an ask status and returns it', async () => {
    const response = await PATCH(patchEvent('ask-1', {
      status: 'answered',
      answer: 'Working on it',
    }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ask.status).toBe('answered');
    expect(json.ask.answer).toBe('Working on it');
  });

  it('rejects invalid JSON, non-object bodies, and unknown asks', async () => {
    const invalidJson = await PATCH(patchEvent('ask-1', '{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await PATCH(patchEvent('ask-1', []));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    const unknown = await PATCH(patchEvent('no-such-ask', { status: 'done' }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not found' });
  });

  it('rejects inactive owning rooms before reading, updating, or dismissing asks', async () => {
    for (const askId of ['ask-archived', 'ask-deleted']) {
      await expectHttpError(() => GET(getEvent(askId)), 410);
      await expectHttpError(() => PATCH(patchEvent(askId, { status: 'answered', answer: 'yes' })), 410);
      await expectHttpError(() => DELETE(deleteEvent(askId)), 410);

      expect(queries.getAsk(askId)).toMatchObject({ status: 'open', answer: null });
    }
  });
});
