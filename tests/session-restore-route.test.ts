import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { POST } = await import('../src/routes/api/sessions/[id]/restore/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(sessionId: string, locals: Record<string, unknown> = {}) {
  return {
    params: { id: sessionId },
    request: new Request(`https://ant.test/api/sessions/${sessionId}/restore`, { method: 'POST' }),
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

describe('/api/sessions/:id/restore', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-restore-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();

    queries.createSession('active-room', 'Active Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('expired-room', 'Expired Room', 'chat', '1h', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
    queries.softDeleteSession('expired-room');
    getDb()
      .prepare(`UPDATE sessions SET deleted_at = datetime('now', '-2 hours') WHERE id = ?`)
      .run('expired-room');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('restores archived and soft-deleted sessions and broadcasts session changes', async () => {
    const archived = await POST(postEvent('archived-room'));
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      id: 'archived-room',
      archived: 0,
      deleted_at: null,
    });
    expect(queries.getSession('archived-room')).toMatchObject({ archived: 0, deleted_at: null });

    const deleted = await POST(postEvent('deleted-room'));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: 'deleted-room',
      archived: 0,
      deleted_at: null,
    });
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenNthCalledWith(1, '__ant_sessions__', { type: 'sessions_changed' });
    expect(broadcast).toHaveBeenNthCalledWith(2, '__ant_sessions__', { type: 'sessions_changed' });
  });

  it('rejects missing, active, and expired recovery-window sessions without broadcasting', async () => {
    await expectHttpError(() => POST(postEvent('missing-room')), 404);
    await expectHttpError(() => POST(postEvent('active-room')), 400);
    await expectHttpError(() => POST(postEvent('expired-room')), 410);
    expect(broadcast).not.toHaveBeenCalled();
    expect(queries.getSession('expired-room')).toMatchObject({ archived: 0 });
    expect((queries.getSession('expired-room') as any).deleted_at).toBeTruthy();
  });

  it('requires same-room write-capable tokens for scoped callers', async () => {
    await expectHttpError(
      () => POST(postEvent('archived-room', { roomScope: { roomId: 'other-room', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => POST(postEvent('archived-room', { roomScope: { roomId: 'archived-room', kind: 'web' } })),
      403,
    );
    expect(queries.getSession('archived-room')).toMatchObject({ archived: 1 });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
