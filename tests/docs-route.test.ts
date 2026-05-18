import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { POST } = await import('../src/routes/api/docs/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/docs', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-docs-route-'));
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

  it('creates a shared doc and returns it', async () => {
    const response = await POST(postEvent({
      id: 'my-research',
      title: 'My Research Doc',
      description: 'Findings from the audit',
      author: 'codex',
    }));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.id).toBe('my-research');
    expect(json.title).toBe('My Research Doc');
    expect(json.status).toBe('draft');
  });

  it('rejects invalid JSON, non-object bodies, missing fields, and duplicates', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const arrayBody = await POST(postEvent([]));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: 'Request body must be a JSON object' });

    const noId = await POST(postEvent({ title: 'No ID' }));
    expect(noId.status).toBe(400);
    expect(await noId.json()).toEqual({ error: 'id and title required' });

    const noTitle = await POST(postEvent({ id: 'no-title' }));
    expect(noTitle.status).toBe(400);
    expect(await noTitle.json()).toEqual({ error: 'id and title required' });

    // Create first, then try duplicate
    await POST(postEvent({ id: 'dup', title: 'First' }));
    const duplicate = await POST(postEvent({ id: 'dup', title: 'Second' }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'Doc already exists' });
  });
});
