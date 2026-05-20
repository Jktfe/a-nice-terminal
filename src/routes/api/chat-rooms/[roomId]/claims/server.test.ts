import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PATCH, POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { setRoomMode } from '$lib/server/roomModesStore';

type AnyHandler = (event: unknown) => unknown;

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): claims POST/PATCH now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'claims-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function eventFor(
  method: 'GET' | 'POST' | 'PATCH',
  roomId: string,
  body?: unknown,
  search = '',
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/claims${search}`);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return { request: new Request(url, init), params: { roomId }, url };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('/api/chat-rooms/:roomId/claims', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-claims-route-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbPath;
  });

  it('creates a working claim for a room message and lists it', async () => {
    const room = createChatRoom({ name: 'claim-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'Claim this' });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, {
        entityKind: 'message',
        entityId: message.id,
        claimKind: 'working',
        claimedByHandle: '@evolveantcodex'
      })
    );
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.claim).toMatchObject({
      entity_kind: 'message',
      entity_id: message.id,
      claim_kind: 'working',
      claimed_by_handle: '@evolveantcodex',
      status: 'active'
    });

    const listed = await run(
      GET as unknown as AnyHandler,
      eventFor('GET', room.id, undefined, `?entityKind=message&entityId=${message.id}`)
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).claims).toHaveLength(1);
  });

  it('returns 409 with the existing claim when another agent races the working claim', async () => {
    const room = createChatRoom({ name: 'claim-conflict-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantsvelte' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'Claim this' });

    await run(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, {
        entityKind: 'message',
        entityId: message.id,
        claimKind: 'working',
        claimedByHandle: '@evolveantcodex'
      })
    );
    const conflict = await run(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, {
        entityKind: 'message',
        entityId: message.id,
        claimKind: 'working',
        claimedByHandle: '@evolveantsvelte'
      })
    );

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).existing.claimed_by_handle).toBe('@evolveantcodex');
  });

  it('uses heads-down default TTL for working claims when ttlMs is omitted', async () => {
    const room = createChatRoom({ name: 'heads-down-claims', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    setRoomMode({ roomId: room.id, mode: 'heads-down', set_by: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'Claim this' });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, {
        entityKind: 'message',
        entityId: message.id,
        claimKind: 'working',
        claimedByHandle: '@evolveantcodex'
      })
    );

    expect(response.status).toBe(201);
    expect((await response.json()).claim.ttl_ms).toBe(30 * 60_000);
  });

  it('marks an active claim done via PATCH', async () => {
    const room = createChatRoom({ name: 'claim-release-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'Claim this' });
    const created = await run(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, {
        entityKind: 'message',
        entityId: message.id,
        claimKind: 'working',
        claimedByHandle: '@evolveantcodex'
      })
    );
    const claimId = (await created.json()).claim.id;

    const patched = await run(
      PATCH as unknown as AnyHandler,
      eventFor('PATCH', room.id, { claimId, status: 'done' })
    );

    expect(patched.status).toBe(200);
    expect((await patched.json()).claim.status).toBe('done');
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-claim', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'Claim this' });
    const response = await run(
      POST as unknown as AnyHandler,
      eventFor(
        'POST',
        room.id,
        {
          entityKind: 'message',
          entityId: message.id,
          claimKind: 'working',
          claimedByHandle: '@evolveantcodex'
        },
        '',
        false
      )
    );
    expect(response.status).toBe(401);
  });

  it('PATCH returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-claim-patch', whoCreatedIt: '@you' });
    const response = await run(
      PATCH as unknown as AnyHandler,
      eventFor('PATCH', room.id, { claimId: 'claim_x', status: 'done' }, '', false)
    );
    expect(response.status).toBe(401);
  });
});
