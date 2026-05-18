import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest } from '../src/lib/server/db.js';
import { GET, POST } from '../src/routes/api/workspaces/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/workspaces', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-workspaces-route-'));
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

  it('lists workspaces sorted by name', async () => {
    await POST(postEvent({ name: 'Zulu', root_dir: '/tmp/zulu' }));
    await POST(postEvent({ name: 'Alpha', root_dir: '/tmp/alpha' }));

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.map((workspace: any) => workspace.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('trims and persists valid workspace names and root directories', async () => {
    const response = await POST(postEvent({
      name: '  Local Repo  ',
      root_dir: '  /Users/jamesking/CascadeProjects/a-nice-terminal  ',
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      name: 'Local Repo',
      root_dir: '/Users/jamesking/CascadeProjects/a-nice-terminal',
    });
    expect(typeof body.id).toBe('string');

    const listed = await GET();
    expect(await listed.json()).toMatchObject([
      {
        id: body.id,
        name: 'Local Repo',
        root_dir: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      },
    ]);
  });

  it('rejects invalid JSON and missing or blank names before DB writes', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    for (const body of [{}, { name: '   ' }, { name: 42 }]) {
      const response = await POST(postEvent(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'name is required' });
    }

    const listed = await GET();
    expect(await listed.json()).toEqual([]);
  });
});
