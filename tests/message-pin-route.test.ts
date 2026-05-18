import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { PATCH } = await import('../src/routes/api/sessions/[id]/messages/[msg_id]/pin/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(roomId: string, msgId: string, body: unknown) {
  return {
    params: { id: roomId, msg_id: msgId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/messages/${msgId}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
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

describe('/api/sessions/:id/messages/:msg_id/pin', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-message-pin-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
    queries.createMessage('msg-a1', 'room-a', 'user', 'hello', 'text', 'complete', '@you', null, null, 'message', '{}');
    queries.createMessage('msg-b1', 'room-b', 'user', 'other', 'text', 'complete', '@you', null, null, 'message', '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('pins and unpins a message in the requested chat room and broadcasts the change', async () => {
    const pin = await PATCH(patchEvent('room-a', 'msg-a1', { pinned: true }));
    const unpin = await PATCH(patchEvent('room-a', 'msg-a1', { pinned: false }));

    expect(pin.status).toBe(200);
    expect(await pin.json()).toEqual({ msgId: 'msg-a1', pinned: true });
    expect(unpin.status).toBe(200);
    expect(await unpin.json()).toEqual({ msgId: 'msg-a1', pinned: false });
    expect(queries.getMessage('msg-a1')).toMatchObject({ pinned: 0 });
    expect(broadcast).toHaveBeenNthCalledWith(1, 'room-a', {
      type: 'message_pinned',
      sessionId: 'room-a',
      msgId: 'msg-a1',
      pinned: true,
    });
    expect(broadcast).toHaveBeenNthCalledWith(2, 'room-a', {
      type: 'message_pinned',
      sessionId: 'room-a',
      msgId: 'msg-a1',
      pinned: false,
    });
  });

  it('rejects malformed JSON and non-boolean pinned payloads without broadcasting', async () => {
    const malformed = await PATCH(patchEvent('room-a', 'msg-a1', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });

    const invalid = await PATCH(patchEvent('room-a', 'msg-a1', { pinned: 'true' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'pinned (boolean) required' });

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects missing, non-chat, inactive, and cross-room message targets', async () => {
    await expectHttpError(() => PATCH(patchEvent('missing-room', 'msg-a1', { pinned: true })), 404);
    await expectHttpError(() => PATCH(patchEvent('terminal-a', 'msg-a1', { pinned: true })), 400);
    await expectHttpError(() => PATCH(patchEvent('archived-room', 'msg-a1', { pinned: true })), 410);
    await expectHttpError(() => PATCH(patchEvent('deleted-room', 'msg-a1', { pinned: true })), 410);
    await expectHttpError(() => PATCH(patchEvent('room-b', 'msg-a1', { pinned: true })), 404);
    await expectHttpError(() => PATCH(patchEvent('room-a', 'missing-msg', { pinned: true })), 404);
    expect(queries.getMessage('msg-a1')).toMatchObject({ pinned: 0 });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
