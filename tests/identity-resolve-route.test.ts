import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST } from '../src/routes/api/identity/resolve/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/identity/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/identity/resolve', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-identity-resolve-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    vi.spyOn(Date, 'now').mockReturnValue(1_770_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects empty or invalid pid chains', async () => {
    for (const body of [{}, { pids: [] }, { pids: [1, 0, -4, { pid: 'x' }] }, '{']) {
      const response = await POST(postEvent(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'pids must be a non-empty array' });
    }
  });

  it('returns identity:null when no registered terminal identity matches', async () => {
    const response = await POST(postEvent({ pids: [4321] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ identity: null });
  });

  it('resolves a direct handle identity and prunes expired identities', async () => {
    const now = Math.floor(Date.now() / 1000);
    queries.registerTerminalIdentity('expired', 9876, null, '@old', null, 'test', now - 1, '{}');
    queries.registerTerminalIdentity('current', 1234, null, '@evolveantcodex', null, 'hook', now + 60, '{}');

    const response = await POST(postEvent({ pids: [9876, 1234] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      identity: {
        sender_id: '@evolveantcodex',
        handle: '@evolveantcodex',
        display_name: null,
        session_id: null,
        pid: 1234,
        pid_start: null,
        source: 'hook',
        registered_at: expect.any(Number),
        expires_at: now + 60,
      },
    });
    expect(queries.resolveTerminalIdentity([{ pid: 9876 }], now)).toBeNull();
  });

  it('prefers session identity details and honours pid_start mismatches', async () => {
    const now = Math.floor(Date.now() / 1000);
    queries.createSession('sess-codex', 'Codex Terminal', 'terminal', 'forever', null, null, '{}');
    queries.setHandle('sess-codex', '@evolveantcodex', 'Codex');
    queries.registerTerminalIdentity('wrong-start', 2468, 'old-start', '@wrong', null, 'manual', now + 60, '{}');
    queries.registerTerminalIdentity('session-start', 2468, 'current-start', null, 'sess-codex', 'register', now + 60, '{}');

    const response = await POST(postEvent({
      pids: [{ pid: 2468, pid_start: 'current-start' }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      identity: {
        sender_id: 'sess-codex',
        handle: '@evolveantcodex',
        display_name: 'Codex',
        session_id: 'sess-codex',
        pid: 2468,
        pid_start: 'current-start',
        source: 'register',
      },
    });
  });
});
