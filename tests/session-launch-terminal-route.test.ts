import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const execCalls: Array<{ file: string; args: string[] }> = [];

vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    execCalls.push({ file, args });
    callback(null, '', '');
  },
}));

const route = await import('../src/routes/api/sessions/[id]/launch-terminal/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;
let originalTerminalApp: string | undefined;

function event(id: string, locals = {}) {
  return { params: { id }, locals } as any;
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

describe('/api/sessions/:id/launch-terminal', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    originalTerminalApp = process.env.ANT_TERMINAL_APP;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-launch-terminal-'));
    process.env.ANT_DATA_DIR = dataDir;
    process.env.ANT_TERMINAL_APP = 'kitty';
    _resetForTest();
    getDb();
    execCalls.length = 0;

    queries.createSession('terminal-1', 'Terminal One', 'terminal', 'forever', null, null, '{}');
    queries.createSession('terminal-2', 'Terminal Two', 'terminal', 'forever', null, null, '{}');
    queries.createSession('chat-room-1', 'Chat Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived-1', 'Archived One', 'terminal', 'forever', null, null, '{}');
    queries.createSession('deleted-01', 'Deleted One', 'terminal', 'forever', null, null, '{}');
    queries.archiveSession('archived-1');
    queries.softDeleteSession('deleted-01');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    if (originalTerminalApp === undefined) delete process.env.ANT_TERMINAL_APP;
    else process.env.ANT_TERMINAL_APP = originalTerminalApp;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns the configured terminal app for active terminal sessions', async () => {
    const response = await route.GET(event('terminal-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ app: 'kitty', label: 'kitty' });
  });

  it('rejects missing, non-terminal, inactive, and cross-room scoped reads', async () => {
    await expectHttpError(() => route.GET(event('missing-01')), 404);
    await expectHttpError(() => route.GET(event('chat-room-1')), 400);
    await expectHttpError(() => route.GET(event('archived-1')), 410);
    await expectHttpError(() => route.GET(event('deleted-01')), 410);
    await expectHttpError(
      () => route.GET(event('terminal-1', { roomScope: { roomId: 'terminal-2', kind: 'web' } })),
      403,
    );
  });

  it('launches active terminal sessions through the configured app', async () => {
    const response = await route.POST(event('terminal-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, app: 'kitty', label: 'kitty' });
    expect(execCalls).toEqual([{ file: 'kitty', args: ['--', 'tmux', 'attach', '-t', 'terminal-1'] }]);
  });

  it('rejects invalid sessions, cross-room tokens, and read-only tokens before launching', async () => {
    await expectHttpError(() => route.POST(event('missing-01')), 404);
    await expectHttpError(() => route.POST(event('chat-room-1')), 400);
    await expectHttpError(() => route.POST(event('archived-1')), 410);
    await expectHttpError(() => route.POST(event('deleted-01')), 410);
    await expectHttpError(
      () => route.POST(event('terminal-1', { roomScope: { roomId: 'terminal-2', kind: 'cli' } })),
      403,
    );
    await expectHttpError(
      () => route.POST(event('terminal-1', { roomScope: { roomId: 'terminal-1', kind: 'web' } })),
      403,
    );

    expect(execCalls).toEqual([]);
  });
});
