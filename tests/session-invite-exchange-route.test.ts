import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { createInvite } from '../src/lib/server/room-invites.js';

const route = await import('../src/routes/api/sessions/[id]/invites/[inviteId]/exchange/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function exchangeEvent(roomId: string, inviteId: string, body: unknown) {
  return {
    params: { id: roomId, inviteId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/invites/${inviteId}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

describe('/api/sessions/:id/invites/:inviteId/exchange', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-invite-exchange-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects inactive rooms before minting invite tokens', async () => {
    const archivedInvite = createInvite({ roomId: 'archived-room', label: 'Archived invite', password: 'test-password', kinds: ['cli'], createdBy: '@you' });
    const deletedInvite = createInvite({ roomId: 'deleted-room', label: 'Deleted invite', password: 'test-password', kinds: ['cli'], createdBy: '@you' });
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');

    await expectHttpError(
      () => route.POST(exchangeEvent('archived-room', archivedInvite.id, { password: 'test-password', kind: 'cli', handle: '@codex' })),
      410,
    );
    await expectHttpError(
      () => route.POST(exchangeEvent('deleted-room', deletedInvite.id, { password: 'test-password', kind: 'cli', handle: '@codex' })),
      410,
    );

    expect(queries.listRoomTokens(archivedInvite.id)).toHaveLength(0);
    expect(queries.listRoomTokens(deletedInvite.id)).toHaveLength(0);
  });
});
