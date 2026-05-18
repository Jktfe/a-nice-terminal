import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('../src/lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { POST } = await import('../src/routes/api/sessions/[id]/typing/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown, id = 'sess-typing', locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    request: new Request(`https://ant.test/api/sessions/${id}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals,
  } as any;
}

describe('/api/sessions/:id/typing', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-typing-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    queries.createSession('sess-typing', 'Typing room', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived', 'Archived', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted', 'Deleted', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived');
    queries.softDeleteSession('deleted');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('broadcasts a trimmed handle and boolean typing flag', async () => {
    const response = await POST(postEvent({
      handle: '  @evolveantcodex  ',
      typing: true,
    }, 'room-a'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('room-a', {
      type: 'typing',
      handle: '@evolveantcodex',
      typing: true,
    });
  });

  it('rejects malformed JSON, missing handles, and non-boolean typing flags', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    for (const body of [{ typing: true }, { handle: '   ', typing: true }]) {
      const response = await POST(postEvent(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'handle is required' });
    }

    for (const typing of ['true', 1, null]) {
      const response = await POST(postEvent({ handle: '@codex', typing }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'typing must be boolean' });
    }
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects cross-room, read-only, missing, and inactive typing updates without broadcasting', async () => {
    await expect(POST(postEvent({ handle: '@codex', typing: true }, 'sess-typing', {
      roomScope: { roomId: 'room-a', kind: 'cli' },
    }))).rejects.toMatchObject({ status: 403 });
    await expect(POST(postEvent({ handle: '@codex', typing: true }, 'sess-typing', {
      roomScope: { roomId: 'sess-typing', kind: 'web' },
    }))).rejects.toMatchObject({ status: 403 });

    const missing = await POST(postEvent({ handle: '@codex', typing: true }, 'missing'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Session not found' });

    const archived = await POST(postEvent({ handle: '@codex', typing: true }, 'archived'));
    expect(archived.status).toBe(410);
    expect(await archived.json()).toEqual({ error: 'Session is inactive' });

    const archivedInvalidJson = await POST(postEvent('{', 'archived'));
    expect(archivedInvalidJson.status).toBe(410);
    expect(await archivedInvalidJson.json()).toEqual({ error: 'Session is inactive' });

    const deleted = await POST(postEvent({ handle: '@codex', typing: true }, 'deleted'));
    expect(deleted.status).toBe(410);
    expect(await deleted.json()).toEqual({ error: 'Session is inactive' });

    expect(broadcast).not.toHaveBeenCalled();
  });
});
