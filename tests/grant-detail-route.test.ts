import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const detail = await import('../src/routes/api/sessions/[id]/grants/[grantId]/+server.js');
const revoke = await import('../src/routes/api/sessions/[id]/grants/[grantId]/revoke/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function event(sessionId: string, grantId: string, locals: Record<string, unknown> = {}) {
  return {
    params: { id: sessionId, grantId },
    url: new URL(`https://ant.test/api/sessions/${sessionId}/grants/${grantId}`),
    request: new Request(`https://ant.test/api/sessions/${sessionId}/grants/${grantId}`, { method: 'POST' }),
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

function createGrant(id: string, sessionId: string, status = 'active') {
  queries.createConsentGrant(
    id,
    sessionId,
    '@codex',
    'file-read',
    JSON.stringify(['docs/a.md', 'docs/b.md']),
    '1h',
    0,
    null,
    status,
    1_700_000_000_000,
    1_700_003_600_000,
    '{}',
  );
}

describe('/api/sessions/:id/grants/:grantId', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-grant-detail-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();

    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');

    createGrant('grant-a', 'room-a');
    createGrant('grant-b', 'room-b');
    createGrant('grant-terminal', 'terminal-a');
    createGrant('grant-archived', 'archived-room');
    createGrant('grant-deleted', 'deleted-room');
    createGrant('grant-revoked', 'room-a', 'revoked');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns a session-owned grant with parsed source_set', async () => {
    const response = await detail.GET(event('room-a', 'grant-a'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.grant).toMatchObject({
      id: 'grant-a',
      session_id: 'room-a',
      source_set: ['docs/a.md', 'docs/b.md'],
    });
  });

  it('revokes an active session-owned grant and rejects repeated revoke', async () => {
    const response = await revoke.POST(event('room-a', 'grant-a'));
    expect(response.status).toBe(200);
    expect((await response.json()).grant).toMatchObject({
      id: 'grant-a',
      session_id: 'room-a',
      status: 'revoked',
      source_set: ['docs/a.md', 'docs/b.md'],
    });
    expect(queries.getConsentGrant('grant-a')).toMatchObject({ status: 'revoked' });

    const repeated = await revoke.POST(event('room-a', 'grant-a'));
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: 'grant is revoked, not active' });
  });

  it('rejects missing, non-chat, inactive, cross-room, and mismatched room-scope targets', async () => {
    await expectHttpError(() => detail.GET(event('missing-room', 'grant-a')), 404);
    await expectHttpError(() => detail.GET(event('terminal-a', 'grant-terminal')), 400);
    await expectHttpError(() => detail.GET(event('archived-room', 'grant-archived')), 410);
    await expectHttpError(() => detail.GET(event('deleted-room', 'grant-deleted')), 410);

    const crossRoom = await detail.GET(event('room-b', 'grant-a'));
    expect(crossRoom.status).toBe(403);
    expect(await crossRoom.json()).toEqual({ error: 'grant does not belong to this session' });

    await expectHttpError(
      () => detail.GET(event('room-a', 'grant-a', { roomScope: { roomId: 'room-b', kind: 'web' } })),
      403,
    );

    await expectHttpError(() => revoke.POST(event('missing-room', 'grant-a')), 404);
    expect((queries.getConsentGrant('grant-a') as any).status).toBe('active');
  });
});
