// M2 #1 — POST /api/sessions/:id/start-interview integration test.
// Strengthens the wire contract the M2 UI lane consumes: status codes,
// response shape, idempotent focus, and meta blob round-trip via the real
// db singleton (not the fake queries used in start-interview.test.ts).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetForTest as resetDbForTest } from '../src/lib/server/db';

const originalCwd = process.cwd();
const originalEnv = process.env.ANT_DATA_DIR;
const tempDirs: string[] = [];

async function freshWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'ant-start-interview-test-'));
  tempDirs.push(dir);
  process.env.ANT_DATA_DIR = join(dir, 'data');
  process.chdir(dir);
  resetDbForTest();
  const db = await import('../src/lib/server/db');
  const route = await import('../src/routes/api/sessions/[id]/start-interview/+server');
  return { dir, queries: db.queries, POST: route.POST };
}

function makeEvent(targetId: string, body: Record<string, unknown> = {}) {
  const url = `http://localhost/api/sessions/${targetId}/start-interview`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { params: { id: targetId }, request, url: new URL(url), locals: {} } as any;
}

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalEnv === undefined) delete process.env.ANT_DATA_DIR;
  else process.env.ANT_DATA_DIR = originalEnv;
  resetDbForTest();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('POST /api/sessions/:id/start-interview', () => {
  it('creates a linked chat for a terminal target', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const response = await POST(makeEvent('t-1'));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      created: true,
      target_session_id: 't-1',
      chat_name: 'Interview: James terminal',
    });
    expect(payload.linked_chat_id).toBeTruthy();

    const target = queries.getSession('t-1') as any;
    expect(target.linked_chat_id).toBe(payload.linked_chat_id);

    const chat = queries.getSession(payload.linked_chat_id) as any;
    expect(chat).toMatchObject({ type: 'chat', name: 'Interview: James terminal' });
  });

  it('returns the existing linked chat on second call (focus, not create)', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const first = await (await POST(makeEvent('t-1'))).json();
    const second = await (await POST(makeEvent('t-1'))).json();

    expect(second).toEqual({
      ok: true,
      created: false,
      linked_chat_id: first.linked_chat_id,
      target_session_id: 't-1',
    });
  });

  it('returns 404 when target session does not exist', async () => {
    const { POST } = await freshWorkspace();
    await expect(POST(makeEvent('missing'))).rejects.toMatchObject({ status: 404 });
  });

  it('also accepts a chat-type target (room can interview itself)', async () => {
    // The real db CHECK constraint already restricts session.type to
    // terminal/chat/agent — invalid_target_type is exercised in the unit
    // test (start-interview.test.ts) against a fake queries object. Here
    // we round-trip the second valid target type to confirm the route is
    // not implicitly terminal-only.
    const { queries, POST } = await freshWorkspace();
    queries.createSession('c-source', 'Source room', 'chat', 'forever', null, null, '{}');

    const payload = await (await POST(makeEvent('c-source'))).json();
    expect(payload).toMatchObject({
      ok: true,
      created: true,
      target_session_id: 'c-source',
      chat_name: 'Interview: Source room',
    });
  });

  it('captures origin_room_id and caller_handle in chat meta', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const payload = await (await POST(makeEvent('t-1', {
      origin_room_id: 'room-abc',
      caller_handle: '@james',
    }))).json();

    const chat = queries.getSession(payload.linked_chat_id) as any;
    const meta = JSON.parse(chat.meta);
    expect(meta).toMatchObject({
      interview: true,
      origin_room_id: 'room-abc',
      caller_handle: '@james',
    });
    expect(typeof meta.started_at_ms).toBe('number');
  });
});
