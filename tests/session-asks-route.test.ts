import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest, queries } from '../src/lib/server/db.js';

const collection = await import('../src/routes/api/sessions/[id]/asks/+server.js');
const detail = await import('../src/routes/api/sessions/[id]/asks/[askId]/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function getEvent(roomId: string) {
  return {
    params: { id: roomId },
    url: new URL(`https://ant.test/api/sessions/${roomId}/asks`),
    locals: {},
  } as any;
}

function postEvent(roomId: string, body: unknown) {
  return {
    params: { id: roomId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/asks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: {},
  } as any;
}

function patchEvent(roomId: string, askId: string, body: unknown) {
  return {
    params: { id: roomId, askId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/asks/${askId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: {},
  } as any;
}

function deleteEvent(roomId: string, askId: string) {
  return {
    params: { id: roomId, askId },
    locals: {},
  } as any;
}

function createAsk(id: string, sessionId: string) {
  queries.createAsk(id, sessionId, null, 'Confirm deployment?', '', null, 'open', 'room', 'room', 'normal', null, 0, 0, '{"source":"test"}');
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

describe('/api/sessions/:id/asks', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-asks-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    createAsk('ask-archived', 'archived-room');
    createAsk('ask-deleted', 'deleted-room');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects inactive rooms before listing, creating, answering, or dismissing asks', async () => {
    for (const [roomId, askId] of [
      ['archived-room', 'ask-archived'],
      ['deleted-room', 'ask-deleted'],
    ] as const) {
      await expectHttpError(() => collection.GET(getEvent(roomId)), 410);
      await expectHttpError(() => collection.POST(postEvent(roomId, { title: 'New ask' })), 410);
      await expectHttpError(() => detail.PATCH(patchEvent(roomId, askId, { status: 'answered', answer: 'yes' })), 410);
      await expectHttpError(() => detail.DELETE(deleteEvent(roomId, askId)), 410);

      expect(queries.listAsks({ sessionId: roomId, statuses: null })).toHaveLength(1);
      expect(queries.getAsk(askId)).toMatchObject({ status: 'open', answer: null });
    }
  });
});
