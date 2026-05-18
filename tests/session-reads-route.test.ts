import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/reads/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function readsEvent(id: string) {
  return { params: { id } } as any;
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

describe('/api/sessions/:id/reads', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-reads-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('reader-a', 'Reader Alpha', 'terminal', 'forever', null, null, '{}');
    queries.createSession('reader-b', 'Reader Beta', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-a', 'Archived A', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-a', 'Deleted A', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-a');
    queries.softDeleteSession('deleted-a');
    queries.setAlias('reader-a', 'reader-alpha');
    queries.createMessage('msg-a1', 'room-a', 'user', 'hello', 'text', 'complete', 'reader-a', null, null, 'message', '{}');
    queries.createMessage('msg-a2', 'room-a', 'assistant', 'reply', 'text', 'complete', 'reader-b', null, null, 'message', '{}');
    queries.createMessage('msg-b1', 'room-b', 'user', 'other room', 'text', 'complete', 'reader-b', null, null, 'message', '{}');
    queries.markRead('msg-a1', 'reader-a');
    queries.markRead('msg-a1', 'reader-b');
    queries.markRead('msg-a2', 'reader-b');
    queries.markRead('msg-b1', 'reader-a');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('groups read receipts by message for the requested chat session', async () => {
    const response = await GET(readsEvent('room-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body.reads).sort()).toEqual(['msg-a1', 'msg-a2']);
    expect(body.reads['msg-a1']).toEqual([
      expect.objectContaining({
        session_id: 'reader-a',
        reader_name: 'reader-alpha',
        reader_handle: '@reader-alpha',
        read_at: expect.any(String),
      }),
      expect.objectContaining({
        session_id: 'reader-b',
        reader_name: 'Reader Beta',
        reader_handle: null,
        read_at: expect.any(String),
      }),
    ]);
    expect(body.reads['msg-a2']).toEqual([
      expect.objectContaining({ session_id: 'reader-b' }),
    ]);
  });

  it('rejects missing, non-chat, and inactive sessions', async () => {
    await expectHttpError(() => GET(readsEvent('missing')), 404);
    await expectHttpError(() => GET(readsEvent('terminal-a')), 400);
    await expectHttpError(() => GET(readsEvent('archived-a')), 410);
    await expectHttpError(() => GET(readsEvent('deleted-a')), 410);
  });
});
