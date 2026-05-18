import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const route = await import('../src/routes/api/sessions/[id]/messages/[msgId]/read/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(roomId: string, msgId: string, body: unknown, locals = {}) {
  return {
    params: { id: roomId, msgId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/messages/${msgId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals,
  } as any;
}

function getEvent(roomId: string, msgId: string, locals = {}) {
  return { params: { id: roomId, msgId }, locals } as any;
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

describe('/api/sessions/:id/messages/:msgId/read', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-message-read-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('reader-a', 'Reader A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('reader-b', 'Reader B', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.setAlias('reader-a', 'reader-a');
    queries.createMessage('msg-a1', 'room-a', 'user', 'hello', 'text', 'complete', '@you', null, null, 'message', '{}');
    queries.createMessage('msg-b1', 'room-b', 'user', 'other', 'text', 'complete', '@you', null, null, 'message', '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('marks a room message read once and broadcasts grouped read metadata', async () => {
    const response = await route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'reader-a' }));
    const duplicate = await route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'reader-a' }));
    const body = await response.json();
    const duplicateBody = await duplicate.json();

    expect(response.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      reads: [
        expect.objectContaining({
          session_id: 'reader-a',
          reader_name: 'reader-a',
          reader_handle: '@reader-a',
          read_at: expect.any(String),
        }),
      ],
    });
    expect(duplicateBody.reads).toHaveLength(1);
    expect(broadcast).toHaveBeenLastCalledWith('room-a', {
      type: 'message_read',
      sessionId: 'room-a',
      messageId: 'msg-a1',
      readerId: 'reader-a',
      reads: duplicateBody.reads,
    });
  });

  it('returns reads for a message only when it belongs to the requested room', async () => {
    await route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'reader-a' }));

    const response = await route.GET(getEvent('room-a', 'msg-a1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reads: [
        expect.objectContaining({ session_id: 'reader-a' }),
      ],
    });
    await expectHttpError(() => route.GET(getEvent('room-b', 'msg-a1')), 404);
  });

  it('rejects malformed JSON, invalid readers, cross-room messages, and inactive rooms before broadcasting', async () => {
    const malformed = await route.POST(postEvent('room-a', 'msg-a1', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });

    const missingReader = await route.POST(postEvent('room-a', 'msg-a1', {}));
    expect(missingReader.status).toBe(400);
    expect(await missingReader.json()).toEqual({ error: 'reader_id required' });

    await expectHttpError(() => route.POST(postEvent('missing-room', 'msg-a1', { reader_id: 'reader-a' })), 404);
    await expectHttpError(() => route.POST(postEvent('archived-room', 'msg-a1', { reader_id: 'reader-a' })), 410);
    await expectHttpError(() => route.POST(postEvent('room-b', 'msg-a1', { reader_id: 'reader-a' })), 404);
    await expectHttpError(() => route.POST(postEvent('room-a', 'missing-msg', { reader_id: 'reader-a' })), 404);
    await expectHttpError(() => route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'missing-reader' })), 404);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('enforces scoped-token access before reading or writing read receipts', async () => {
    await route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'reader-a' }));
    broadcast.mockReset();

    const sameRoomRead = await route.GET(getEvent('room-a', 'msg-a1', {
      roomScope: { roomId: 'room-a', kind: 'web' },
    }));

    expect(sameRoomRead.status).toBe(200);
    await expectHttpError(
      () => route.GET(getEvent('room-a', 'msg-a1', { roomScope: { roomId: 'room-b', kind: 'web' } })),
      403,
    );
    await expectHttpError(
      () => route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'reader-b' }, { roomScope: { roomId: 'room-a', kind: 'web' } })),
      403,
    );
    await expectHttpError(
      () => route.POST(postEvent('room-a', 'msg-a1', { reader_id: 'reader-b' }, { roomScope: { roomId: 'room-b', kind: 'cli' } })),
      403,
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});
