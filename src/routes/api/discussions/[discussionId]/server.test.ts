import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PATCH } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests, postMessage } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createDiscussion } from '$lib/server/chatDiscussionStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-disc-id-'));
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

async function callGet(discussionId: string): Promise<Response> {
  const url = `http://localhost/api/discussions/${discussionId}`;
  const event = { request: new Request(url), params: { discussionId }, url: new URL(url) } as unknown as Parameters<typeof GET>[0];
  try { return (await GET(event)) as Response; }
  catch (t) { if (t instanceof Response) return t; const f = t as { status?: number; body?: { message?: string } }; if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status }); throw t; }
}

async function callPatch(discussionId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/discussions/${discussionId}`;
  const request = new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const event = { request, params: { discussionId } } as unknown as Parameters<typeof PATCH>[0];
  try { return (await PATCH(event)) as Response; }
  catch (t) { if (t instanceof Response) return t; const f = t as { status?: number; body?: { message?: string } }; if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status }); throw t; }
}

function setupDiscussion() {
  const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
  const terminal = upsertTerminal({ pid: 5555, pid_start: 'ps5', name: 'caller-term' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: terminal.id });
  const parent = postMessage({ roomId: room.id, authorHandle: '@caller', body: 'parent' });
  const d = createDiscussion({ roomId: room.id, parentMessageId: parent.id, opened_by: '@caller' });
  return { roomId: room.id, discussionId: d.id, pidChain: [{ pid: 5555, pid_start: 'ps5' }] };
}

describe('GET /api/discussions/:discussionId', () => {
  it('200 returns discussion + filtered child messages', async () => {
    const { roomId, discussionId } = setupDiscussion();
    postMessage({ roomId, authorHandle: '@caller', body: 'in-disc-1', discussion_id: discussionId });
    postMessage({ roomId, authorHandle: '@caller', body: 'other-thread' });
    postMessage({ roomId, authorHandle: '@caller', body: 'in-disc-2', discussion_id: discussionId });
    const payload = await (await callGet(discussionId)).json();
    expect(payload.discussion.id).toBe(discussionId);
    expect(payload.messages.length).toBe(2);
    expect(payload.messages.every((m: { discussion_id: string }) => m.discussion_id === discussionId)).toBe(true);
  });
  it('404 when discussion not found', async () => {
    expect((await callGet('phantom')).status).toBe(404);
  });
});

describe('PATCH /api/discussions/:discussionId (close + re-close)', () => {
  it('first PATCH transitions open→closed + stamps closed_by/at/summary', async () => {
    const { discussionId, pidChain } = setupDiscussion();
    const payload = await (await callPatch(discussionId, { summary: 'wrap-up', pidChain })).json();
    expect(payload.discussion.status).toBe('closed');
    expect(payload.discussion.summary).toBe('wrap-up');
    expect(payload.discussion.closed_by).toBe('@caller');
    expect(typeof payload.discussion.closed_at).toBe('number');
  });

  it('subsequent PATCH updates summary in place per Q4-4b', async () => {
    const { discussionId, pidChain } = setupDiscussion();
    await callPatch(discussionId, { summary: 'first', pidChain });
    const payload = await (await callPatch(discussionId, { summary: 'revised', pidChain })).json();
    expect(payload.discussion.summary).toBe('revised');
  });

  it('400 when summary is missing/empty', async () => {
    const { discussionId, pidChain } = setupDiscussion();
    expect((await callPatch(discussionId, { pidChain })).status).toBe(400);
    expect((await callPatch(discussionId, { summary: '   ', pidChain })).status).toBe(400);
  });

  it('403 when caller is not a room member', async () => {
    const { discussionId } = setupDiscussion();
    expect((await callPatch(discussionId, { summary: 'x', pidChain: [{ pid: 99999, pid_start: 'fake' }] })).status).toBe(403);
  });

  it('400 when pidChain missing', async () => {
    const { discussionId } = setupDiscussion();
    expect((await callPatch(discussionId, { summary: 'x' })).status).toBe(400);
  });

  it('404 when discussion not found', async () => {
    expect((await callPatch('phantom', { summary: 'x', pidChain: [{ pid: 1, pid_start: 'p' }] })).status).toBe(404);
  });
});
