import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/terminal/history/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function historyEvent(id: string, query = '', locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    url: new URL(`https://ant.test/api/sessions/${id}/terminal/history${query}`),
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

describe('/api/sessions/:id/terminal/history', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-terminal-history-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('terminal', 'Terminal', 'terminal', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('archived', 'Archived', 'terminal', 'forever', null, null, '{}');
    queries.createSession('deleted', 'Deleted', 'terminal', 'forever', null, null, '{}');
    queries.archiveSession('archived');
    queries.softDeleteSession('deleted');
    queries.appendTranscriptWithText('terminal', 1, '\x1b[31mhello raw\x1b[0m', 'hello raw', 1_000, 0);
    queries.appendTranscriptWithText('terminal', 2, 'newest raw', 'newest raw', 2_000, 16);
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns stripped range rows newest-first with clamped limits', async () => {
    const response = await GET(historyEvent('terminal', '?since=0&limit=1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      session_id: 'terminal',
      mode: 'range',
      since_ms: 0,
      limit: 1,
      count: 1,
      rows: [
        {
          chunk_index: 2,
          ts_ms: 2_000,
          byte_offset: 16,
          size: 'newest raw'.length,
          text: 'newest raw',
        },
      ],
    });
  });

  it('can return raw transcript bytes when requested', async () => {
    const response = await GET(historyEvent('terminal', '?since=0&raw=1&limit=5'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      session_id: 'terminal',
      mode: 'range',
      limit: 5,
      count: 2,
    });
    expect(body.rows.map((row: any) => row.raw)).toEqual(['newest raw', '\x1b[31mhello raw\x1b[0m']);
  });

  it('returns search snippets from transcript FTS', async () => {
    const response = await GET(historyEvent('terminal', '?grep=hello&limit=10'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      session_id: 'terminal',
      mode: 'search',
      query: 'hello',
      limit: 10,
      count: 1,
    });
    expect(body.rows[0]).toMatchObject({
      chunk_index: 1,
      ts_ms: 1_000,
      snippet: '<mark>hello</mark> raw',
    });
  });

  it('rejects missing sessions', async () => {
    await expectHttpError(() => GET(historyEvent('missing', '?since=0')), 404);
  });

  it('rejects cross-room scoped tokens and inactive sessions before returning transcript history', async () => {
    await expectHttpError(() => GET(historyEvent('terminal', '?since=0', {
      roomScope: { roomId: 'room-b', kind: 'cli' },
    })), 403);
    await expectHttpError(() => GET(historyEvent('archived', '?since=0')), 410);
    await expectHttpError(() => GET(historyEvent('deleted', '?since=0')), 410);
  });
});
