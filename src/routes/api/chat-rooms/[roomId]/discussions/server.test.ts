import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests, postMessage } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { setRoomMode } from '$lib/server/roomModesStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-disc-rooms-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callGet(roomId: string, statusFilter?: string): Promise<Response> {
  const search = statusFilter ? `?status=${statusFilter}` : '';
  const url = `http://localhost/api/chat-rooms/${roomId}/discussions${search}`;
  const event = { request: new Request(url), params: { roomId }, url: new URL(url) } as unknown as Parameters<typeof GET>[0];
  try { return (await GET(event)) as Response; }
  catch (t) { if (t instanceof Response) return t; const f = t as { status?: number; body?: { message?: string } }; if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status }); throw t; }
}

async function callPost(roomId: string, body: object, cookie?: string): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/discussions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof POST>[0];
  try { return (await POST(event)) as Response; }
  catch (t) { if (t instanceof Response) return t; const f = t as { status?: number; body?: { message?: string } }; if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status }); throw t; }
}

function setupRoomWithMember() {
  const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
  const terminal = upsertTerminal({ pid: 7777, pid_start: 'ps7', name: 'caller-term' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: terminal.id });
  const parent = postMessage({ roomId: room.id, authorHandle: '@caller', body: 'parent' });
  return { roomId: room.id, pidChain: [{ pid: 7777, pid_start: 'ps7' }], parentMessageId: parent.id };
}

describe('GET /api/chat-rooms/:roomId/discussions', () => {
  it('returns empty list for a fresh room', async () => {
    const room = createChatRoom({ name: 'fresh', whoCreatedIt: '@you' });
    const payload = await (await callGet(room.id)).json();
    expect(payload.discussions).toEqual([]);
  });
  it('404 when room does not exist', async () => {
    expect((await callGet('phantom')).status).toBe(404);
  });
  it('400 on invalid status filter', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    expect((await callGet(room.id, 'bogus')).status).toBe(400);
  });
});

describe('POST /api/chat-rooms/:roomId/discussions', () => {
  it('201 + discussion row when caller is a member and parent exists', async () => {
    const { roomId, pidChain, parentMessageId } = setupRoomWithMember();
    const response = await callPost(roomId, { parentMessageId, title: 'side-thread', pidChain });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.discussion.room_id).toBe(roomId);
    expect(payload.discussion.parent_message_id).toBe(parentMessageId);
    expect(payload.discussion.title).toBe('side-thread');
    expect(payload.discussion.status).toBe('open');
    expect(payload.discussion.opened_by).toBe('@caller');
  });

  it('404 when room does not exist', async () => {
    expect((await callPost('phantom', { parentMessageId: 'x' })).status).toBe(404);
  });

  it('400 when parentMessageId missing', async () => {
    const { roomId, pidChain } = setupRoomWithMember();
    expect((await callPost(roomId, { pidChain })).status).toBe(400);
  });

  it('404 when parentMessageId is not in this room', async () => {
    const { roomId, pidChain } = setupRoomWithMember();
    expect((await callPost(roomId, { parentMessageId: 'msg_phantom', pidChain })).status).toBe(404);
  });

  // M3.6a-v1 T2 PRE-BLOCK A: discussions strict-only (no warning phase). No
  // legacy clientAuthorHandle to deprecate, so missing identity ALWAYS 403s
  // with the Q3 hint body even when the deprecation flag is in warning phase
  // for /messages, /members.
  it('default env (warning phase elsewhere): pidChain missing → 403 with hint (no warning grace for discussions)', async () => {
    const { roomId, parentMessageId } = setupRoomWithMember();
    const response = await callPost(roomId, { parentMessageId });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.message).toMatch(/Server-resolved identity required/);
  });

  it('default env: pidChain present-but-unresolved → 403 (no warning grace)', async () => {
    const { roomId, parentMessageId } = setupRoomWithMember();
    const response = await callPost(roomId, { parentMessageId, pidChain: [{ pid: 99999, pid_start: 'fake' }] });
    expect(response.status).toBe(403);
  });

  it('409 + existing discussion id when duplicate parentMessageId', async () => {
    const { roomId, pidChain, parentMessageId } = setupRoomWithMember();
    const first = await (await callPost(roomId, { parentMessageId, pidChain })).json();
    const dup = await callPost(roomId, { parentMessageId, pidChain });
    expect(dup.status).toBe(409);
    const dupPayload = await dup.json();
    expect(dupPayload.discussion.id).toBe(first.discussion.id);
  });

  it('GET list reflects created discussion', async () => {
    const { roomId, pidChain, parentMessageId } = setupRoomWithMember();
    await callPost(roomId, { parentMessageId, title: 'show-me', pidChain });
    const listed = await (await callGet(roomId)).json();
    expect(listed.discussions.length).toBe(1);
    expect(listed.discussions[0].title).toBe('show-me');
  });

  it('Q7 closed-room guard: 409 when room mode is closed AND no discussion created', async () => {
    const { roomId, pidChain, parentMessageId } = setupRoomWithMember();
    setRoomMode({ roomId, mode: 'closed', set_by: '@caller' });
    const response = await callPost(roomId, { parentMessageId, pidChain });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.message).toMatch(/Room is closed/);
    // No discussion created
    const listed = await (await callGet(roomId, 'all')).json();
    expect(listed.discussions).toEqual([]);
  });
});

describe('M3.6a-v1 T2 strict-403 phase on /discussions POST', () => {
  const previousAuthEnv = process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
  afterEach(() => {
    if (previousAuthEnv === undefined) delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
    else process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = previousAuthEnv;
  });

  it('strict phase: pidChain missing → 403 with Q3 hint body', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const { roomId, parentMessageId } = setupRoomWithMember();
    const response = await callPost(roomId, { parentMessageId });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.message).toMatch(/Server-resolved identity required/);
  });

  it('strict phase: VALID pidChain still succeeds 201 (Q2 mixed-mode permanent)', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const { roomId, pidChain, parentMessageId } = setupRoomWithMember();
    const response = await callPost(roomId, { parentMessageId, pidChain });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-auth-deprecation')).toBeNull();
  });

  // Canonical RQO M3.6a-v1 T1+T2+T3 gate-watch: discussions cookie-resolves
  // path. Valid ant_browser_session cookie alone is sufficient (no pidChain
  // required), returns 201, NO X-Auth-Deprecation header, and opened_by
  // reflects the cookie-resolved handle.
  it('valid ant_browser_session cookie → 201 + opened_by from cookie + NO warning header (no pidChain needed)', async () => {
    const { roomId, parentMessageId } = setupRoomWithMember();
    const terminal = upsertTerminal({ pid: 9999, pid_start: 'ps9', name: '@browser-disc' });
    addMembership({ room_id: roomId, handle: '@browser-disc', terminal_id: terminal.id });
    const created = createBrowserSession({ roomId, authorHandle: '@browser-disc' });
    if (!created) throw new Error('createBrowserSession returned null in test fixture');
    const response = await callPost(
      roomId,
      { parentMessageId, title: 'cookie-only-discussion' },
      `ant_browser_session=${created.browserSessionSecret}`
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('x-auth-deprecation')).toBeNull();
    const payload = await response.json();
    expect(payload.discussion.opened_by).toBe('@browser-disc');
    expect(payload.discussion.title).toBe('cookie-only-discussion');
  });

  it('strict phase: cookie-present-invalid beats valid pidChain (anti-spoof invariant)', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const { roomId, pidChain, parentMessageId } = setupRoomWithMember();
    const url = `http://localhost/api/chat-rooms/${roomId}/discussions`;
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'ant_browser_session=invalid-secret-xyz' },
      body: JSON.stringify({ parentMessageId, pidChain })
    });
    const event = { request, params: { roomId } } as unknown as Parameters<typeof POST>[0];
    let status = 0;
    try {
      const response = (await POST(event)) as Response;
      status = response.status;
    } catch (thrown) { status = (thrown as { status: number }).status; }
    expect(status).toBe(403);
  });
});
