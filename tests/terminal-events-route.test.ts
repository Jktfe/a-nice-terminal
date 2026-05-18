import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/terminal/events/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function eventsEvent(id: string, query = '') {
  return {
    params: { id },
    url: new URL(`https://ant.test/api/sessions/${id}/terminal/events${query}`),
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

describe('/api/sessions/:id/terminal/events', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-terminal-events-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('terminal', 'Terminal', 'terminal', 'forever', null, null, '{}');
    queries.appendTerminalEvent('terminal', 1_000, 'window-add', JSON.stringify({ window: 1 }));
    queries.appendTerminalEvent('terminal', 2_000, 'layout-change', '{not-json');
    queries.appendTerminalEvent('terminal', 3_000, 'window-add', JSON.stringify({ window: 2 }));
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns newest-first terminal events with parsed JSON payloads and limit clamp', async () => {
    const response = await GET(eventsEvent('terminal', '?since=0&limit=2'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      session_id: 'terminal',
      since_ms: 0,
      kind: null,
      limit: 2,
      count: 2,
      rows: [
        { ts_ms: 3_000, kind: 'window-add', data: { window: 2 } },
        { ts_ms: 2_000, kind: 'layout-change', data: { _raw: '{not-json' } },
      ],
    });
  });

  it('filters by kind and since timestamp', async () => {
    const response = await GET(eventsEvent('terminal', '?since=1500&kind=window-add&limit=10'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      session_id: 'terminal',
      since_ms: 1_500,
      kind: 'window-add',
      limit: 10,
      count: 1,
      rows: [
        { ts_ms: 3_000, kind: 'window-add', data: { window: 2 } },
      ],
    });
  });

  it('normalizes invalid limits to the default bounded range', async () => {
    const response = await GET(eventsEvent('terminal', '?since=0&limit=not-a-number'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      limit: 100,
      count: 3,
    });
  });

  it('rejects missing sessions', async () => {
    await expectHttpError(() => GET(eventsEvent('missing', '?since=0')), 404);
  });
});
