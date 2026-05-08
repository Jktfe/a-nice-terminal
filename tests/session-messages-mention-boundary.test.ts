import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { POST as postMessage } from '../src/routes/api/sessions/[id]/messages/+server.js';
import { _resetForTest, queries } from '../src/lib/server/db.js';

const ENV_KEYS = ['ANT_DATA_DIR'] as const;
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
let dataDir = '';

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

function messageRequest(body: unknown): Request {
  return new Request('https://ant.test/api/sessions/room-a/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/sessions/[id]/messages mention boundary', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ant-messages-boundary-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
  });

  afterEach(() => {
    _resetForTest();
    restoreEnv();
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('persists and routes messages ending in @handle with a trailing boundary space', async () => {
    const response = await postMessage({
      params: { id: 'room-a' },
      request: messageRequest({
        role: 'user',
        content: 'please read @antCC',
        format: 'text',
      }),
      locals: {},
    } as any);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.content).toBe('please read @antCC ');
    const stored: any[] = queries.listMessages('room-a') as any[];
    expect(stored.at(-1)?.content).toBe('please read @antCC ');
  });
});
