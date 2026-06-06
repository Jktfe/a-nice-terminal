/**
 * Per-discussion PATCH tests (chat decide endpoint).
 *
 * Verifies the contract:
 *   - 404 on unknown room
 *   - 404 on unknown discussion or discussion in different room
 *   - 400 on missing / blank decision
 *   - 403 on missing identity
 *   - 200 with closed discussion + decision recorded as summary
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PATCH as discussionPatch } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { createDiscussion, getDiscussion } from '$lib/server/chatDiscussionStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'PATCH', path: string, init: RequestInit, params: Record<string, string>): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

async function setupRoomWithDiscussion(): Promise<{ roomId: string; discussionId: string; pidChain: Array<{ pid: number; pid_start: string | null }> }> {
  const room = createChatRoom({ name: 'decide-test', whoCreatedIt: '@you' });
  const message = postMessage({
    roomId: room.id,
    authorHandle: '@you',
    authorDisplayName: '@you',
    body: 'parent message',
    kind: 'human'
  });
  const term = upsertTerminal({ pid: 12345, pid_start: 'p_start', name: '@you' });
  addMembership({ room_id: room.id, handle: '@you', terminal_id: term.id });
  const discussion = createDiscussion({
    roomId: room.id,
    parentMessageId: message.id,
    title: 'Database choice',
    opened_by: '@you'
  });
  return {
    roomId: room.id,
    discussionId: discussion.id,
    pidChain: [{ pid: 12345, pid_start: 'p_start' }]
  };
}

describe('PATCH /api/chat-rooms/[roomId]/discussions/[discussionId]', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-decide-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
  });

  it('returns 404 on unknown room', async () => {
    const response = await runHandler(
      discussionPatch as unknown as AnyHandler,
      eventFor('PATCH', '/api/chat-rooms/nope/discussions/whatever', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'use postgres' })
      }, { roomId: 'nope', discussionId: 'whatever' })
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 on unknown discussion in known room', async () => {
    const { roomId } = await setupRoomWithDiscussion();
    const response = await runHandler(
      discussionPatch as unknown as AnyHandler,
      eventFor('PATCH', `/api/chat-rooms/${roomId}/discussions/phantom`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'use postgres', pidChain: [{ pid: 12345, pid_start: 'p_start' }] })
      }, { roomId, discussionId: 'phantom' })
    );
    expect(response.status).toBe(404);
  });

  it('returns 400 on missing decision', async () => {
    const { roomId, discussionId, pidChain } = await setupRoomWithDiscussion();
    const response = await runHandler(
      discussionPatch as unknown as AnyHandler,
      eventFor('PATCH', `/api/chat-rooms/${roomId}/discussions/${discussionId}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pidChain })
      }, { roomId, discussionId })
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 on blank decision', async () => {
    const { roomId, discussionId, pidChain } = await setupRoomWithDiscussion();
    const response = await runHandler(
      discussionPatch as unknown as AnyHandler,
      eventFor('PATCH', `/api/chat-rooms/${roomId}/discussions/${discussionId}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: '   ', pidChain })
      }, { roomId, discussionId })
    );
    expect(response.status).toBe(400);
  });

  it('returns 403 when identity cannot resolve', async () => {
    const { roomId, discussionId } = await setupRoomWithDiscussion();
    const response = await runHandler(
      discussionPatch as unknown as AnyHandler,
      eventFor('PATCH', `/api/chat-rooms/${roomId}/discussions/${discussionId}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'use postgres' })
      }, { roomId, discussionId })
    );
    expect(response.status).toBe(403);
  });

  it('closes the discussion with the decision as summary on success', async () => {
    const { roomId, discussionId, pidChain } = await setupRoomWithDiscussion();
    const response = await runHandler(
      discussionPatch as unknown as AnyHandler,
      eventFor('PATCH', `/api/chat-rooms/${roomId}/discussions/${discussionId}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'use postgres', pidChain })
      }, { roomId, discussionId })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { discussion: { status: string; summary: string; closed_by: string } };
    expect(body.discussion.status).toBe('closed');
    expect(body.discussion.summary).toBe('use postgres');
    expect(body.discussion.closed_by).toBe('@JWPK');
    // Persist check:
    const stored = getDiscussion(discussionId);
    expect(stored?.status).toBe('closed');
    expect(stored?.summary).toBe('use postgres');
  });
});
