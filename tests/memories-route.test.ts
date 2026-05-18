import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { POST } = await import('../src/routes/api/memories/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/memories', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-memories-route-'));
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

  it('creates a memory and returns it', async () => {
    const response = await POST(postEvent({
      key: 'my/key',
      value: 'some data',
    }));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.memory.key).toBe('my/key');
  });

  it('rejects invalid JSON, non-object bodies, and missing fields', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ ok: false, error: 'Invalid JSON' });

    const arrayBody = await POST(postEvent([]));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ ok: false, error: 'Request body must be a JSON object' });

    const noKey = await POST(postEvent({ value: 'data' }));
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toEqual({ ok: false, error: 'key and value are required' });

    const noValue = await POST(postEvent({ key: 'k' }));
    expect(noValue.status).toBe(400);
    expect(await noValue.json()).toEqual({ ok: false, error: 'key and value are required' });
  });
});
