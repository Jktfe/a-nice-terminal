import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/messages/search/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function getEvent(sessionId: string, query = '', locals: Record<string, unknown> = {}) {
  return {
    params: { id: sessionId },
    url: new URL(`https://ant.test/api/sessions/${sessionId}/messages/search${query}`),
    locals,
  } as any;
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

describe('/api/sessions/:id/messages/search', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-message-search-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();

    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createMessage('msg-a1', 'room-a', 'user', 'alpha shared needle first', 'text', 'complete', '@you', null, null, 'message', '{}');
    queries.createMessage('msg-a2', 'room-a', 'assistant', 'alpha shared needle second', 'text', 'complete', '@codex', null, null, 'message', '{}');
    queries.createMessage('msg-b1', 'room-b', 'assistant', 'alpha shared needle other room', 'text', 'complete', '@codex', null, null, 'message', '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns session-scoped message results and clamps requested limits', async () => {
    const response = await GET(getEvent('room-a', '?q=alpha&limit=999'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.map((row: any) => row.id).sort()).toEqual(['msg-a1', 'msg-a2']);
    expect(body.results.map((row: any) => row.session_id)).toEqual(['room-a', 'room-a']);
    expect(body.results[0].snippet).toContain('<mark>');

    const invalidLimit = await GET(getEvent('room-a', '?q=alpha&limit=-5'));
    expect(invalidLimit.status).toBe(200);
    expect((await invalidLimit.json()).results).toHaveLength(2);
  });

  it('validates session existence before returning empty-query shortcuts', async () => {
    const empty = await GET(getEvent('room-a'));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ results: [] });

    const missing = await GET(getEvent('missing-room'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ results: [], error: 'Session not found' });
  });

  it('enforces room-scoped readers and reports invalid FTS queries', async () => {
    await expectHttpError(
      () => GET(getEvent('room-a', '?q=alpha', { roomScope: { roomId: 'room-b', kind: 'web' } })),
      403,
    );

    const invalid = await GET(getEvent('room-a', '?q=%22unterminated'));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ results: [], error: 'Invalid search query' });
  });
});
