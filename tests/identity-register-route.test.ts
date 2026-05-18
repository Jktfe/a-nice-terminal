import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST } from '../src/routes/api/identity/register/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/identity/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/identity/register', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-identity-register-'));
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

  it('rejects requests without a valid root pid or pid list', async () => {
    for (const body of [{}, { pid: 1, handle: '@codex' }, { pids: [{ pid: 1 }], handle: '@codex' }, '{']) {
      const response = await POST(postEvent(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'root_pid or pids must include an integer greater than 1',
      });
    }
  });

  it('requires either handle or session_id and rejects unknown sessions', async () => {
    const missingIdentity = await POST(postEvent({ pid: 1234 }));
    expect(missingIdentity.status).toBe(400);
    expect(await missingIdentity.json()).toEqual({ error: 'handle or session_id required' });

    const missingSession = await POST(postEvent({ pid: 1234, session_id: 'missing' }));
    expect(missingSession.status).toBe(404);
    expect(await missingSession.json()).toEqual({ error: 'session_id not found' });
  });

  it('normalizes handle, defaults source, and clamps short TTLs to one minute', async () => {
    const now = Math.floor(Date.now() / 1000);

    const response = await POST(postEvent({
      root_pid: 2468,
      pid_start: '  start-a  ',
      handle: 'evolveantcodex',
      ttl_seconds: 1,
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      identity: {
        root_pid: 2468,
        pid_start: 'start-a',
        handle: '@evolveantcodex',
        session_id: null,
        source: 'manual',
        registered_at: now,
        expires_at: now + 60,
      },
      identities: [
        {
          root_pid: 2468,
          handle: '@evolveantcodex',
        },
      ],
    });
  });

  it('uses session handle details and clamps long TTLs to one day', async () => {
    const now = Math.floor(Date.now() / 1000);
    queries.createSession('sess-1', 'Codex Terminal', 'terminal', 'forever', null, null, '{}');
    queries.setHandle('sess-1', '@evolveantcodex', 'Codex');

    const response = await POST(postEvent({
      pid: 3579,
      session_id: 'sess-1',
      ttl: '999h',
      source: 'hook',
      meta: { channel: 'terminal' },
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      identity: {
        root_pid: 3579,
        handle: '@evolveantcodex',
        session_id: 'sess-1',
        source: 'hook',
        expires_at: now + 24 * 60 * 60,
      },
    });
  });

  it('deduplicates and caps pid-list registration to 64 identities', async () => {
    const pids = [
      { pid: 4000, pid_start: '  root-start  ' },
      { pid: 4000, pid_start: 'duplicate' },
      ...Array.from({ length: 70 }, (_, index) => ({ pid: 4001 + index })),
    ];

    const response = await POST(postEvent({
      pids,
      handle: '@codex',
      duration: '15m',
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.identities).toHaveLength(64);
    expect(body.identity).toMatchObject({
      root_pid: 4000,
      pid_start: 'root-start',
      handle: '@codex',
    });
    expect(new Set(body.identities.map((entry: any) => entry.root_pid)).size).toBe(64);
  });
});
