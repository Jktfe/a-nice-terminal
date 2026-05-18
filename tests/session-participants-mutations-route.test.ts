import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest, queries } from '../src/lib/server/db.js';

const route = await import('../src/routes/api/sessions/[id]/participants/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function requestEvent(method: string, roomId: string, body: unknown = {}) {
  return {
    params: { id: roomId },
    url: new URL(`https://ant.test/api/sessions/${roomId}/participants`),
    request: new Request(`https://ant.test/api/sessions/${roomId}/participants`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals: {},
  } as any;
}

describe('/api/sessions/:id/participants mutations', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-participants-mutations-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession('active-room', 'Active Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('member-a', 'Member A', 'terminal', 'forever', null, null, '{}');
    queries.addRoomMember('archived-room', 'member-a', 'participant', null, '@member-a');
    queries.addRoomMember('deleted-room', 'member-a', 'participant', null, '@member-a');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects inactive rooms before participant add, focus, or removal mutations', async () => {
    for (const roomId of ['archived-room', 'deleted-room']) {
      const add = await route.POST(requestEvent('POST', roomId, { session_id: 'member-a' }));
      expect(add.status).toBe(410);
      expect(await add.json()).toEqual({ error: 'room is inactive' });

      const focus = await route.PATCH(requestEvent('PATCH', roomId, { session_id: 'member-a', attention_state: 'focus', reason: 'test' }));
      expect(focus.status).toBe(410);
      expect(await focus.json()).toEqual({ error: 'room is inactive' });

      const remove = await route.DELETE(requestEvent('DELETE', roomId, { session_id: 'member-a' }));
      expect(remove.status).toBe(410);
      expect(await remove.json()).toEqual({ error: 'room is inactive' });
    }
  });
});
