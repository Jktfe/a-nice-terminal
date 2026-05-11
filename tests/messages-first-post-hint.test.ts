// M2 of ant-skills-on-demand-2026-05-09: when a sender posts to a
// room for the first time, the POST /api/sessions/:id/messages
// response carries a one-line skills hint (`hint: ...`, `firstPost: true`).
// On every subsequent post from the same sender, no hint is emitted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST as postMessage } from '../src/routes/api/sessions/[id]/messages/+server.js';

const ROOM_ID = 'first-post-hint-room';
const SENDER_ID = 'first-post-hint-sender';

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

describe('first-post skills hint (M2)', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-first-post-hint-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession(ROOM_ID, 'First Post Hint Room', 'chat', '15m', null, null, '{}');
    queries.createSession(SENDER_ID, 'Sender', 'chat', '15m', null, null, '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns firstPost+hint on the first message from a sender', async () => {
    const res = await postMessage(makeEvent({
      role: 'user',
      content: 'first message from sender',
      format: 'text',
      sender_id: SENDER_ID,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.firstPost).toBe(true);
    expect(typeof body.hint).toBe('string');
    expect(body.hint).toContain('ant skill list');
  });

  it('omits the hint on the second + subsequent messages', async () => {
    // First post — should carry hint
    const first = await postMessage(makeEvent({
      role: 'user',
      content: 'first',
      format: 'text',
      sender_id: SENDER_ID,
    }));
    expect((await first.json()).firstPost).toBe(true);

    // Second post — must NOT carry hint or firstPost flag
    const second = await postMessage(makeEvent({
      role: 'user',
      content: 'second',
      format: 'text',
      sender_id: SENDER_ID,
    }));
    const secondBody = await second.json();
    expect(secondBody.firstPost).toBeUndefined();
    expect(secondBody.hint).toBeUndefined();
  });

  it('does not fire on chat_break even on a sender\'s first appearance', async () => {
    const res = await postMessage(makeEvent({
      role: 'system',
      content: 'reset',
      format: 'text',
      sender_id: SENDER_ID,
      msg_type: 'chat_break',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.firstPost).toBeUndefined();
    expect(body.hint).toBeUndefined();
  });

  it('normalises literal /break posts into chat_break markers for non-web clients', async () => {
    const res = await postMessage(makeEvent({
      role: 'user',
      content: '/break mobile smoke',
      format: 'text',
      sender_id: SENDER_ID,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.msg_type).toBe('chat_break');
    expect(body.content).toBe('mobile smoke');
    expect(body.role).toBe('system');
    expect(body.firstPost).toBeUndefined();
    expect(body.hint).toBeUndefined();
  });

  it('skips when sender_id is missing', async () => {
    const res = await postMessage(makeEvent({
      role: 'user',
      content: 'anonymous',
      format: 'text',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.firstPost).toBeUndefined();
    expect(body.hint).toBeUndefined();
  });

  it('fires once per (room, sender) — different senders each get their own hint', async () => {
    const otherSender = 'other-sender';
    queries.createSession(otherSender, 'Other', 'chat', '15m', null, null, '{}');

    const a = await postMessage(makeEvent({
      role: 'user', content: 'a1', format: 'text', sender_id: SENDER_ID,
    }));
    expect((await a.json()).firstPost).toBe(true);

    const b = await postMessage(makeEvent({
      role: 'user', content: 'b1', format: 'text', sender_id: otherSender,
    }));
    expect((await b.json()).firstPost).toBe(true);

    const a2 = await postMessage(makeEvent({
      role: 'user', content: 'a2', format: 'text', sender_id: SENDER_ID,
    }));
    expect((await a2.json()).firstPost).toBeUndefined();
  });
});
