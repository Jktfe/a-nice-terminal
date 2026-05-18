import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { PATCH } from '../src/routes/api/sessions/order/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/sessions/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function createSession(id: string, name = id) {
  queries.createSession(id, name, 'terminal', 'forever', null, null, '{}');
}

function sortIndexes(): Record<string, number | null> {
  const rows = getDb().prepare('SELECT id, sort_index FROM sessions ORDER BY id').all() as Array<{
    id: string;
    sort_index: number | null;
  }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.sort_index]));
}

describe('/api/sessions/order', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-sessions-order-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    createSession('a', 'Alpha');
    createSession('b', 'Bravo');
    createSession('c', 'Charlie');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reorders provided ids and appends omitted active sessions', async () => {
    const response = await PATCH(patchEvent({ ids: [' b ', 'a'] }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, ids: ['b', 'a', 'c'] });
    expect(sortIndexes()).toEqual({ a: 1, b: 0, c: 2 });
  });

  it('accepts orderedIds and de-duplicates repeated ids', async () => {
    const response = await PATCH(patchEvent({ orderedIds: ['c', 'c', 'a'] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ids: ['c', 'a', 'b'] });
    expect(sortIndexes()).toEqual({ a: 1, b: 2, c: 0 });
  });

  it('resets existing sort indexes', async () => {
    await PATCH(patchEvent({ ids: ['c', 'b', 'a'] }));

    const response = await PATCH(patchEvent({ reset: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reset: true });
    expect(sortIndexes()).toEqual({ a: null, b: null, c: null });
  });

  it('rejects invalid JSON, empty ids, unknown ids, and archived sessions', async () => {
    const invalidJson = await PATCH(patchEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'ids must be a non-empty array of session ids' });

    const empty = await PATCH(patchEvent({ ids: ['   ', 123] }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'ids must be a non-empty array of session ids' });

    const unknown = await PATCH(patchEvent({ ids: ['missing'] }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      error: 'Cannot order archived, deleted, or unknown sessions',
      invalidIds: ['missing'],
    });

    queries.archiveSession('a');
    const archived = await PATCH(patchEvent({ ids: ['a'] }));
    expect(archived.status).toBe(400);
    expect(await archived.json()).toEqual({
      error: 'Cannot order archived, deleted, or unknown sessions',
      invalidIds: ['a'],
    });
  });
});
