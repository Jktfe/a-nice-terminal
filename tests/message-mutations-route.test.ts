import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const route = await import('../src/routes/api/sessions/[id]/messages/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(roomId: string, msgId: string | null, body: unknown, locals = {}) {
  const url = new URL(`https://ant.test/api/sessions/${roomId}/messages`);
  if (msgId) url.searchParams.set('msgId', msgId);
  return {
    params: { id: roomId },
    url,
    request: new Request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals,
  } as any;
}

function deleteEvent(roomId: string, msgId: string | null, locals = {}) {
  const url = new URL(`https://ant.test/api/sessions/${roomId}/messages`);
  if (msgId) url.searchParams.set('msgId', msgId);
  return { params: { id: roomId }, url, locals } as any;
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

describe('/api/sessions/:id/messages admin mutations', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-message-mutations-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();

    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.createMessage('msg-a1', 'room-a', 'user', 'hello', 'text', 'complete', '@you', null, null, 'message', '{"keep":true}');
    queries.createMessage('msg-archived', 'archived-room', 'user', 'archived', 'text', 'complete', '@you', null, null, 'message', '{}');
    queries.createMessage('msg-deleted', 'deleted-room', 'user', 'deleted', 'text', 'complete', '@you', null, null, 'message', '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('updates and deletes messages in active rooms', async () => {
    const patch = await route.PATCH(patchEvent('room-a', 'msg-a1', { meta: { status: 'seen' } }));
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ msgId: 'msg-a1', meta: { keep: true, status: 'seen' } });
    expect(JSON.parse((queries.getMessage('msg-a1') as any).meta)).toEqual({ keep: true, status: 'seen' });

    const remove = await route.DELETE(deleteEvent('room-a', 'msg-a1'));
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ ok: true });
    expect(queries.getMessage('msg-a1')).toBeUndefined();
  });

  it('rejects inactive rooms before updating or deleting messages', async () => {
    await expectHttpError(
      () => route.PATCH(patchEvent('archived-room', 'msg-archived', { meta: { status: 'seen' } })),
      410,
    );
    await expectHttpError(() => route.DELETE(deleteEvent('deleted-room', 'msg-deleted')), 410);

    expect(queries.getMessage('msg-archived')).toBeTruthy();
    expect(queries.getMessage('msg-deleted')).toBeTruthy();
    expect(JSON.parse((queries.getMessage('msg-archived') as any).meta)).toEqual({});
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('returns structured 400 for malformed message meta updates without mutating state', async () => {
    const malformed = await route.PATCH(patchEvent('room-a', 'msg-a1', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });
    expect(JSON.parse((queries.getMessage('msg-a1') as any).meta)).toEqual({ keep: true });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
