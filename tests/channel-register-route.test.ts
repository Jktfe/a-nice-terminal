import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { DELETE, POST } from '../src/routes/api/channel/register/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/channel/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function deleteEvent(handle: string | null) {
  const url = new URL('https://ant.test/api/channel/register');
  if (handle !== null) url.searchParams.set('handle', handle);
  return { url } as any;
}

describe('/api/channel/register', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-channel-register-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('registers and deregisters a channel mapping', async () => {
    const registered = await POST(postEvent({
      handle: '  @evolveantcodex  ',
      port: 55123,
      session_id: '  zj4jlety9q  ',
    }));

    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual({ ok: true });
    expect(queries.listChannels()).toMatchObject([
      {
        handle: '@evolveantcodex',
        port: 55123,
        session_id: 'zj4jlety9q',
      },
    ]);

    const deleted = await DELETE(deleteEvent('@evolveantcodex'));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(queries.listChannels()).toEqual([]);
  });

  it('rejects invalid JSON and invalid handles with 400 responses', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    for (const body of [{}, { handle: '   ', port: 55123 }, { handle: 42, port: 55123 }]) {
      const response = await POST(postEvent(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'handle is required (string)' });
    }
  });

  it('rejects non-integer and out-of-range ports with 400 responses', async () => {
    for (const port of [0, 3.14, -1, 65536, '55123']) {
      const response = await POST(postEvent({ handle: '@codex', port }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'port must be an integer from 1 to 65535' });
    }
    expect(queries.listChannels()).toEqual([]);
  });

  it('rejects DELETE without a handle query parameter', async () => {
    const response = await DELETE(deleteEvent(null));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'handle query param is required' });
  });
});
