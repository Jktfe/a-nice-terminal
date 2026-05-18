import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();
const setCliFlag = vi.fn();

vi.mock('$lib/server/ws-broadcast', () => ({
  broadcast,
}));

vi.mock('$lib/server/pty-client', () => ({
  ptyClient: {
    setCliFlag,
  },
}));

const { PATCH } = await import('../src/routes/api/sessions/[id]/cli-flag/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(id: string, body: unknown, locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    request: new Request(`https://ant.test/api/sessions/${id}/cli-flag`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals,
  } as any;
}

function createSession(id: string, type = 'terminal', meta = '{"keep":true}') {
  queries.createSession(id, id, type, 'forever', null, null, meta);
}

describe('/api/sessions/:id/cli-flag', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-cli-flag-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    setCliFlag.mockReset();
    createSession('terminal');
    createSession('chat', 'chat');
    createSession('archived');
    createSession('deleted');
    queries.archiveSession('archived');
    queries.softDeleteSession('deleted');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('trims and persists valid cli flags, updates metadata, notifies PTY, and broadcasts', async () => {
    const response = await PATCH(patchEvent('terminal', { cli_flag: '  codex-cli  ' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'terminal', cli_flag: 'codex-cli' });
    expect(queries.getSession('terminal')).toMatchObject({ cli_flag: 'codex-cli' });
    expect(JSON.parse((queries.getSession('terminal') as any).meta)).toEqual({
      keep: true,
      agent_driver: 'codex-cli',
    });
    expect(setCliFlag).toHaveBeenCalledWith('terminal', 'codex-cli', 15);
    expect(broadcast).toHaveBeenCalledWith('terminal', {
      type: 'cli_flag_updated',
      sessionId: 'terminal',
      cli_flag: 'codex-cli',
    });
  });

  it('clears cli flags and removes metadata without notifying PTY for non-terminal sessions', async () => {
    queries.setCliFlag('chat', 'codex-cli');
    queries.updateSession(null, null, null, JSON.stringify({ agent_driver: 'codex-cli', keep: true }), 'chat');

    const response = await PATCH(patchEvent('chat', { cli_flag: null }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'chat', cli_flag: null });
    expect(queries.getSession('chat')).toMatchObject({ cli_flag: null });
    expect(JSON.parse((queries.getSession('chat') as any).meta)).toEqual({ keep: true });
    expect(setCliFlag).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON, missing sessions, invalid flags, and non-string flags', async () => {
    const malformed = await PATCH(patchEvent('terminal', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });

    const missing = await PATCH(patchEvent('missing', { cli_flag: 'codex-cli' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Session not found' });

    const invalid = await PATCH(patchEvent('terminal', { cli_flag: 'not-a-mode' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid cli_flag: "not-a-mode"' });

    const wrongType = await PATCH(patchEvent('terminal', { cli_flag: 123 }));
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ error: 'cli_flag must be a string or null' });
  });

  it('resets corrupt session metadata instead of failing the update', async () => {
    queries.updateSession(null, null, null, '{', 'terminal');

    const response = await PATCH(patchEvent('terminal', { cli_flag: 'claude-code' }));

    expect(response.status).toBe(200);
    expect(JSON.parse((queries.getSession('terminal') as any).meta)).toEqual({
      agent_driver: 'claude-code',
    });
  });

  it('rejects cross-room, read-only, and inactive updates without side effects', async () => {
    await expect(PATCH(patchEvent('terminal', { cli_flag: 'codex-cli' }, {
      roomScope: { roomId: 'chat', kind: 'cli' },
    }))).rejects.toMatchObject({ status: 403 });
    await expect(PATCH(patchEvent('terminal', { cli_flag: 'codex-cli' }, {
      roomScope: { roomId: 'terminal', kind: 'web' },
    }))).rejects.toMatchObject({ status: 403 });

    const archived = await PATCH(patchEvent('archived', { cli_flag: 'codex-cli' }));
    expect(archived.status).toBe(410);
    expect(await archived.json()).toEqual({ error: 'Session is inactive' });

    const archivedMalformed = await PATCH(patchEvent('archived', '{'));
    expect(archivedMalformed.status).toBe(410);
    expect(await archivedMalformed.json()).toEqual({ error: 'Session is inactive' });

    const deleted = await PATCH(patchEvent('deleted', { cli_flag: 'codex-cli' }));
    expect(deleted.status).toBe(410);
    expect(await deleted.json()).toEqual({ error: 'Session is inactive' });

    expect(queries.getSession('terminal')).toMatchObject({ cli_flag: null });
    expect(queries.getSession('archived')).toMatchObject({ cli_flag: null });
    expect(queries.getSession('deleted')).toMatchObject({ cli_flag: null });
    expect(setCliFlag).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
