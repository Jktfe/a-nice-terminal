import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/run-events/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function runEventsEvent(id: string, query = '') {
  return {
    params: { id },
    url: new URL(`https://ant.test/api/sessions/${id}/run-events${query}`),
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

describe('/api/sessions/:id/run-events', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-run-events-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('terminal', 'Terminal', 'terminal', 'forever', null, null, '{}');
    queries.createSession('chat', 'Linked Chat', 'chat', 'forever', null, null, JSON.stringify({
      auto_linked_terminal_id: 'terminal',
    }));
    queries.appendRunEvent('terminal', 1_000, 'terminal', 'medium', 'prompt', 'first prompt', JSON.stringify({ prompt: 'first' }), JSON.stringify({ chunk: 1 }));
    queries.appendRunEvent('terminal', 2_000, 'status', 'high', 'terminal_stop', 'stop requested', '{bad-json', 'raw-string');
    queries.appendRunEvent('terminal', 3_000, 'terminal', 'medium', 'prompt', 'second prompt', JSON.stringify({ prompt: 'second' }), null);
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns chronological events with parsed payloads and raw_ref values', async () => {
    const response = await GET(runEventsEvent('terminal', '?since=0&limit=2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      session_id: 'terminal',
      terminal_id: 'terminal',
      since_ms: 0,
      limit: 2,
      count: 2,
    });
    expect(body.events).toEqual([
      expect.objectContaining({
        ts_ms: 2_000,
        source: 'status',
        kind: 'terminal_stop',
        text: 'stop requested',
        payload: {},
        raw_ref: 'raw-string',
      }),
      expect.objectContaining({
        ts_ms: 3_000,
        source: 'terminal',
        kind: 'prompt',
        text: 'second prompt',
        payload: { prompt: 'second' },
        raw_ref: null,
      }),
    ]);
  });

  it('resolves linked chat sessions to their owning terminal', async () => {
    const response = await GET(runEventsEvent('chat', '?since=0&q=second&limit=10'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      session_id: 'chat',
      terminal_id: 'terminal',
      count: 1,
      events: [
        expect.objectContaining({ session_id: 'terminal', text: 'second prompt' }),
      ],
    });
  });

  it('applies source and kind filters with bounded limits', async () => {
    const response = await GET(runEventsEvent('terminal', '?since=0&source=terminal&kind=prompt&limit=not-a-number'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      limit: 200,
      count: 2,
    });
    expect(body.events.map((event: any) => event.text)).toEqual(['first prompt', 'second prompt']);
  });

  it('rejects missing sessions', async () => {
    await expectHttpError(() => GET(runEventsEvent('missing', '?since=0')), 404);
  });
});
