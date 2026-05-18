import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { createInvite, exchangePassword } from '../src/lib/server/room-invites.js';

const invitesRoute = await import('../src/routes/api/sessions/[id]/invites/+server.js');
const inviteRoute = await import('../src/routes/api/sessions/[id]/invites/[inviteId]/+server.js');
const tokenRoute = await import('../src/routes/api/sessions/[id]/invites/[inviteId]/tokens/[tokenId]/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function createInviteEvent(roomId: string) {
  return {
    params: { id: roomId },
    url: new URL(`https://ant.test/api/sessions/${roomId}/invites`),
    request: new Request(`https://ant.test/api/sessions/${roomId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Operators', password: 'test-password', kinds: ['cli'], created_by: '@you' }),
    }),
    locals: {},
  } as any;
}

function deleteInviteEvent(roomId: string, inviteId: string) {
  return {
    params: { id: roomId, inviteId },
    locals: {},
  } as any;
}

function deleteTokenEvent(roomId: string, inviteId: string, tokenId: string) {
  return {
    params: { id: roomId, inviteId, tokenId },
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

describe('/api/sessions/:id/invites mutations', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-invite-mutations-'));
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

  it('rejects inactive rooms before invite create, invite revoke, or token revoke mutations', async () => {
    for (const roomId of ['archived-room', 'deleted-room']) {
      const invite = createInvite({ roomId, label: 'Existing invite', password: 'test-password', kinds: ['cli'], createdBy: '@you' });
      const token = exchangePassword({ inviteId: invite.id, password: 'test-password', kind: 'cli', handle: '@codex' });
      expect(token).not.toBeNull();

      if (roomId === 'archived-room') queries.archiveSession(roomId);
      else queries.softDeleteSession(roomId);

      await expectHttpError(() => invitesRoute.POST(createInviteEvent(roomId)), 410);
      await expectHttpError(() => inviteRoute.DELETE(deleteInviteEvent(roomId, invite.id)), 410);
      await expectHttpError(() => tokenRoute.DELETE(deleteTokenEvent(roomId, invite.id, token!.tokenId)), 410);

      expect(queries.listRoomInvites(roomId)).toHaveLength(1);
      expect((queries.getRoomInvite(invite.id) as any).revoked_at).toBeNull();
      expect((queries.getRoomToken(token!.tokenId) as any).revoked_at).toBeNull();
    }
  });
});
