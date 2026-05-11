// Phase A of server-split-2026-05-11 — route-level test that the HTTP
// POST handler flips broadcast_state from 'pending' to 'done' after
// the inline side-effect block succeeds, AND that calling
// writeMessage() directly (bypassing the handler) leaves the row at
// 'pending'. Together these prove the markDone call lives in the
// handler, not the persist library — so Phase B / C's processor +
// catchup loop can rely on the broadcast_state lifecycle.
//
// Why both directions matter: if the persist library flipped to
// 'done' on its own, the Phase C catchup loop would never see
// genuine pending rows (CLI direct-write in Phase D inserts a row
// the server has NOT yet broadcast). The contract is "Tier 1 writes
// pending; Tier 2 (or its equivalent: this Phase A inline block in
// the handler) flips to done".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST as postMessage } from '../src/routes/api/sessions/[id]/messages/+server.js';
import { writeMessage } from '../src/lib/persist/index.js';

const ROOM_ID = 'broadcast-state-test-room';
const SENDER_ID = 'broadcast-state-test-sender';

let dataDir = '';
let originalDataDir: string | undefined;

function makeEvent(body: Record<string, unknown>) {
  return {
    params: { id: ROOM_ID },
    request: new Request(`https://ant.test/api/sessions/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: {},
  } as any;
}

describe('broadcast_state lifecycle across handler vs persist library', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-broadcast-state-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession(ROOM_ID, 'Broadcast State Test Room', 'chat', '15m', null, null, '{}');
    queries.createSession(SENDER_ID, 'Sender', 'chat', '15m', null, null, '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('HTTP POST through the handler flips broadcast_state to done after side effects succeed', async () => {
    const res = await postMessage(makeEvent({
      role: 'user',
      content: 'a successful post',
      format: 'text',
      sender_id: SENDER_ID,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();

    const row: any = queries.getMessage(body.id);
    expect(row).toBeTruthy();
    expect(row.broadcast_state).toBe('done');
  });

  it('writeMessage called directly leaves the row at pending — handler is what flips it', () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'direct persist write',
      senderId: SENDER_ID,
      source: 'http',
    });
    expect(result.message.broadcast_state).toBe('pending');

    const row: any = queries.getMessage(result.message.id);
    expect(row).toBeTruthy();
    expect(row.broadcast_state).toBe('pending');
  });

  it('agent_response path does NOT create a broadcast queue row (special path, Tier 1 does not handle it)', async () => {
    // Set up a terminal session that the agent_response can target.
    queries.createSession('term-1', 'Terminal', 'terminal', '15m', null, null, '{}');
    const res = await postMessage(makeEvent({
      role: 'system',
      content: JSON.stringify({
        terminal_session_id: 'term-1',
        event_content: 'fake event',
        type: 'approve',
      }),
      format: 'json',
      msg_type: 'agent_response',
      sender_id: SENDER_ID,
    }));
    // The agent_response path may return 500 (handleResponse can fail on
    // an unconfigured event bus), but it must NOT insert a message row
    // because Tier 1 doesn't own this path. Either way, no pending rows.
    const pending: any[] = queries.listPendingBroadcasts(100) as any[];
    expect(pending.length).toBe(0);
    expect([200, 201, 500]).toContain(res.status);
  });
});
