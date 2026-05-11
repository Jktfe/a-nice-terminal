// Phase C of server-split-2026-05-11 — focused tests for
// /api/internal/notify-new-message. The endpoint must (a) return 202
// immediately, (b) gate auth via assertCanWrite, (c) trigger
// replayPendingBroadcasts under the hood so a freshly-inserted
// pending row gets flipped to done shortly after.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest as _resetDbForTest, queries } from '../src/lib/server/db.js';
import { _resetForTest as _resetCatchupForTest } from '../src/lib/server/processor/catchup.js';
import { writeMessage } from '../src/lib/persist/index.js';
import { POST as postNotify } from '../src/routes/api/internal/notify-new-message/+server.js';

const ROOM_ID = 'notify-test-room';
const SENDER_ID = 'notify-test-sender';

let dataDir = '';
let originalDataDir: string | undefined;

function makeEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/internal/notify-new-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals: {},
    params: {},
    url: new URL('https://ant.test/api/internal/notify-new-message'),
  } as any;
}

describe('POST /api/internal/notify-new-message', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-notify-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetDbForTest();
    _resetCatchupForTest();
    queries.createSession(ROOM_ID, 'Notify Test', 'chat', '15m', null, null, '{}');
    queries.createSession(SENDER_ID, 'Sender', 'chat', '15m', null, null, '{}');
  });

  afterEach(() => {
    _resetDbForTest();
    _resetCatchupForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns 202 Accepted within 50ms even with a populated pending queue', async () => {
    // Seed the pending queue so the replay has real work to do (and
    // would be slow if we awaited it). The endpoint must still return
    // immediately.
    for (let i = 0; i < 5; i++) {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: `seed ${i}`,
        senderId: SENDER_ID,
        source: 'http',
      });
    }

    const t0 = Date.now();
    const res = await postNotify(makeEvent({ id: 'whatever' }));
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(202);
    expect(elapsed).toBeLessThan(50);
    const body = await res.json();
    expect(body.accepted).toBe(true);
  });

  it('triggers the catch-up loop so pending rows flip to done shortly after the 202', async () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'pending for notify',
      senderId: SENDER_ID,
      source: 'http',
    });
    expect((queries.getMessage(result.message.id) as any).broadcast_state).toBe('pending');

    const res = await postNotify(makeEvent({ id: result.message.id }));
    expect(res.status).toBe(202);

    // The replay is fire-and-forget; give it microtasks + a small tick
    // to drain. 100ms is generous for an in-process replay of one row.
    await new Promise((r) => setTimeout(r, 100));

    const row: any = queries.getMessage(result.message.id);
    expect(row.broadcast_state).toBe('done');
  });

  it('accepts a request with no body and still returns 202', async () => {
    const res = await postNotify({
      request: new Request('https://ant.test/api/internal/notify-new-message', {
        method: 'POST',
      }),
      locals: {},
      params: {},
      url: new URL('https://ant.test/api/internal/notify-new-message'),
    } as any);
    expect(res.status).toBe(202);
  });
});
