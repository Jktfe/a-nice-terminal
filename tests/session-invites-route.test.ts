import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { createInvite, exchangePassword } from '../src/lib/server/room-invites.js';

const { GET } = await import('../src/routes/api/sessions/[id]/invites/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function getEvent(roomId: string, locals = {}) {
  return {
    params: { id: roomId },
    url: new URL(`https://ant.test/api/sessions/${roomId}/invites`),
    locals,
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

describe('/api/sessions/:id/invites', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-invites-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
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

  it('lists room invites and issued token metadata for admin callers', async () => {
    const invite = createInvite({ roomId: 'room-a', label: 'Operators', password: 'test-password', kinds: ['cli', 'web'], createdBy: '@you' });
    const token = exchangePassword({ inviteId: invite.id, password: 'test-password', kind: 'cli', handle: '@codex' });

    const response = await GET(getEvent('room-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({
      id: invite.id,
      room_id: 'room-a',
      label: 'Operators',
      kinds: ['cli', 'web'],
      created_by: '@you',
    });
    expect(body.invites[0].share.cli).toContain(`invite=${invite.id}`);
    expect(body.invites[0].tokens).toEqual([
      expect.objectContaining({ id: token?.tokenId, kind: 'cli', handle: '@codex' }),
    ]);
  });

  it('rejects room-scoped tokens and inactive or missing rooms before exposing invite metadata', async () => {
    createInvite({ roomId: 'room-a', label: 'Operators', password: 'test-password', kinds: ['cli'], createdBy: '@you' });

    await expectHttpError(
      () => GET(getEvent('room-a', { roomScope: { roomId: 'room-a', kind: 'web' } })),
      403,
    );
    await expectHttpError(
      () => GET(getEvent('missing-room')),
      404,
    );
    await expectHttpError(
      () => GET(getEvent('archived-room')),
      410,
    );
    await expectHttpError(
      () => GET(getEvent('deleted-room')),
      410,
    );
  });
});
