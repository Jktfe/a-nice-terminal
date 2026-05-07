// POST /api/sessions/:id/start-interview — multi-participant redesign integration test.
//
// Strengthens the wire contract under the new model:
//   - Each call creates a fresh chat (no idempotent focus on a linked one).
//   - Response shape: { ok, chat_id, chat_name, participants_invited, seed_posted, invite_failures? }.
//   - target.linked_chat_id is NOT set (interview is no longer a 1:1 pairing).
//   - Pre-invitation hits /api/sessions/:id/terminal/input — we stub event.fetch
//     to capture the invitations rather than spawning real PTYs.
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
  const inviteCalls: Array<{ url: string; body: string }> = [];
  const stubFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const reqBody = init?.body;
    inviteCalls.push({ url, body: typeof reqBody === 'string' ? reqBody : '' });
    // Pretend every invite succeeds.
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const url = `http://localhost/api/sessions/${targetId}/start-interview`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const event = {
    params: { id: targetId },
    request,
    url: new URL(url),
    locals: {},
    fetch: stubFetch,
  } as any;
  return { event, inviteCalls };
}

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalEnv === undefined) delete process.env.ANT_DATA_DIR;
  else process.env.ANT_DATA_DIR = originalEnv;
  resetDbForTest();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('POST /api/sessions/:id/start-interview (multi-participant redesign)', () => {
  it('creates a fresh chat without setting target.linked_chat_id', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const { event, inviteCalls } = makeEvent('t-1');
    const response = await POST(event);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      chat_name: 'Interview: James terminal',
      participants_invited: ['t-1'],
      seed_posted: false,
    });
    expect(payload.chat_id).toBeTruthy();

    // Target's linked_chat_id MUST remain unset — interview is no longer a pairing.
    const target = queries.getSession('t-1') as any;
    expect(target.linked_chat_id).toBeFalsy();

    const chat = queries.getSession(payload.chat_id) as any;
    expect(chat).toMatchObject({ type: 'chat', name: 'Interview: James terminal' });

    // Pre-invite was called once (for the primary participant).
    expect(inviteCalls).toHaveLength(1);
    expect(inviteCalls[0].url).toContain('/api/sessions/t-1/terminal/input');
  });

  it('creates a NEW chat on the second call (no idempotent focus)', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const first = await (await POST(makeEvent('t-1').event)).json();
    const second = await (await POST(makeEvent('t-1').event)).json();

    expect(first.chat_id).toBeTruthy();
    expect(second.chat_id).toBeTruthy();
    expect(second.chat_id).not.toBe(first.chat_id);
  });

  it('returns 404 when target session does not exist', async () => {
    const { POST } = await freshWorkspace();
    await expect(POST(makeEvent('missing').event)).rejects.toMatchObject({ status: 404 });
  });

  it('accepts a chat-type target (e.g. interview about a room)', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('c-source', 'Source room', 'chat', 'forever', null, null, '{}');

    const payload = await (await POST(makeEvent('c-source').event)).json();
    expect(payload).toMatchObject({
      ok: true,
      chat_name: 'Interview: Source room',
      participants_invited: ['c-source'],
    });
    // Chat-type targets don't get a join command (only terminals do), so no
    // pre-invite for this case beyond the chat creation itself.
  });

  it('does not double-prefix the chat name when target is already an interview', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession(
      'c-1',
      'Interview: James',
      'chat',
      'forever',
      null,
      null,
      JSON.stringify({ interview: true }),
    );

    const payload = await (await POST(makeEvent('c-1').event)).json();
    expect(payload.chat_name).toBe('Interview: James');  // not "Interview: Interview: James"
  });

  it('captures origin_room_id and caller_handle in chat meta', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const payload = await (await POST(makeEvent('t-1', {
      origin_room_id: 'room-abc',
      caller_handle: '@james',
    }).event)).json();

    const chat = queries.getSession(payload.chat_id) as any;
    const meta = JSON.parse(chat.meta);
    expect(meta).toMatchObject({
      interview: true,
      origin_room_id: 'room-abc',
      caller_handle: '@james',
    });
    expect(typeof meta.started_at_ms).toBe('number');
  });

  it('invites every additional participant terminal', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');
    queries.createSession('t-vera', 'Vera', 'terminal', 'forever', null, null, '{}');
    queries.createSession('t-house', 'House', 'terminal', 'forever', null, null, '{}');

    const { event, inviteCalls } = makeEvent('t-1', { participants: ['t-vera', 't-house'] });
    const payload = await (await POST(event)).json();

    expect(payload.participants_invited).toEqual(['t-1', 't-vera', 't-house']);
    expect(inviteCalls).toHaveLength(3);
    const invitedIds = inviteCalls.map((c) => c.url).sort();
    expect(invitedIds[0]).toContain('/api/sessions/t-1/terminal/input');
    expect(invitedIds[1]).toContain('/api/sessions/t-house/terminal/input');
    expect(invitedIds[2]).toContain('/api/sessions/t-vera/terminal/input');

    // Each invite carries the chat ID + name.
    for (const call of inviteCalls) {
      const body = JSON.parse(call.body);
      expect(body.text).toContain(payload.chat_id);
      expect(body.text).toContain(payload.chat_name);
    }
  });

  it('skips non-terminal participants on the invite step', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');
    queries.createSession('c-other', 'Some chat', 'chat', 'forever', null, null, '{}');

    const { event, inviteCalls } = makeEvent('t-1', { participants: ['c-other'] });
    const payload = await (await POST(event)).json();

    expect(payload.participants_invited).toEqual(['t-1', 'c-other']);
    // Only the terminal got the join-command; the chat target was skipped.
    expect(inviteCalls).toHaveLength(1);
    expect(inviteCalls[0].url).toContain('/api/sessions/t-1/terminal/input');
  });

  it('reports invite_failures when a terminal-input call fails', async () => {
    const { queries, POST } = await freshWorkspace();
    queries.createSession('t-1', 'James terminal', 'terminal', 'forever', null, null, '{}');

    const url = 'http://localhost/api/sessions/t-1/start-interview';
    const failingFetch: typeof fetch = async () => new Response('nope', { status: 500 });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const event = {
      params: { id: 't-1' },
      request,
      url: new URL(url),
      locals: {},
      fetch: failingFetch,
    } as any;

    const payload = await (await POST(event)).json();
    expect(payload.ok).toBe(true);
    expect(payload.invite_failures).toEqual([{ session_id: 't-1', status: 500, error: 'terminal/input 500' }]);
  });
});
