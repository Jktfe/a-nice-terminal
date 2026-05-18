import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();

vi.mock('../src/lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const { PATCH } = await import('../src/routes/api/sessions/[id]/handle/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(id: string, body: unknown, locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    locals,
    request: new Request(`https://ant.test/api/sessions/${id}/handle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function createSession(id: string, name = id) {
  queries.createSession(id, name, 'terminal', 'forever', null, null, '{}');
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

describe('/api/sessions/:id/handle', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-handle-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    createSession('target', 'Target');
    createSession('other', 'Other');
    queries.setHandle('other', '@taken', 'Taken');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('normalizes trimmed handles, persists display name, and broadcasts the update', async () => {
    const response = await PATCH(patchEvent('target', {
      handle: '  evolveantcodex  ',
      display_name: '  Codex  ',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      handle: '@evolveantcodex',
      display_name: 'Codex',
    });
    expect(queries.getSession('target')).toMatchObject({
      handle: '@evolveantcodex',
      display_name: 'Codex',
    });
    expect(broadcast).toHaveBeenCalledWith('target', {
      type: 'handle_updated',
      sessionId: 'target',
      handle: '@evolveantcodex',
      display_name: 'Codex',
    });
  });

  it('allows clearing an existing handle and display name', async () => {
    queries.setHandle('target', '@target', 'Target');

    const response = await PATCH(patchEvent('target', { handle: null, display_name: '' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handle: null, display_name: null });
    expect(queries.getSession('target')).toMatchObject({
      handle: null,
      display_name: null,
    });
  });

  it('rejects malformed JSON, missing sessions, duplicate handles, and room-scoped callers', async () => {
    const invalidJson = await PATCH(patchEvent('target', '{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const missing = await PATCH(patchEvent('missing', { handle: '@new' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Session not found' });

    const duplicate = await PATCH(patchEvent('target', { handle: ' taken ' }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: '@taken is already taken' });

    await expectHttpError(
      () => PATCH(patchEvent('target', { handle: '@blocked' }, { roomScope: { roomId: 'target', kind: 'cli' } })),
      403,
    );
  });
});
