import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST } from '../src/routes/api/sessions/[id]/messages/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(roomId: string, body: Record<string, unknown> | string) {
  return {
    params: { id: roomId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals: {},
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

describe('/api/sessions/:id/messages POST route state guards', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-messages-post-route-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();

    queries.createSession('active-room', 'Active Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects inactive sessions before parsing JSON or writing messages', async () => {
    await expectHttpError(() => POST(postEvent('archived-room', '{')), 410);
    await expectHttpError(() => POST(postEvent('deleted-room', {
      role: 'user',
      content: 'must not persist',
      format: 'text',
    })), 410);

    expect(queries.listMessages('archived-room')).toHaveLength(0);
    expect(queries.listMessages('deleted-room')).toHaveLength(0);
  });
});
