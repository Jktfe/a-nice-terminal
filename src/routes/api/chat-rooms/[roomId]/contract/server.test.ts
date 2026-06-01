import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'contract-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function makeEvent(roomId: string, body: Record<string, unknown>, withAuth = true): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/contract`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    params: { roomId },
    url
  } as unknown as AnyEvent;
}

async function run(event: AnyEvent): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const res = await POST(event);
    return { status: res.status, body: await res.json() };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { status: thrown.status, body: await thrown.json().catch(() => ({})) };
    }
    const f = thrown as { status?: number; body?: Record<string, unknown> };
    if (typeof f?.status === 'number') return { status: f.status, body: f.body ?? {} };
    throw thrown;
  }
}

describe('POST /api/chat-rooms/:roomId/contract', () => {
  it('binds a contract to a room', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const res = await run(makeEvent(room.id, { contractId: 'speed-matters-governance-v1' }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contractId).toBe('speed-matters-governance-v1');
  });

  it('rejects unauthenticated requests', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const res = await run(makeEvent(room.id, { contractId: 'x' }, false));
    expect(res.status).toBe(401);
  });

  it('clears contract when contractId is null', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    await run(makeEvent(room.id, { contractId: 'speed-matters-governance-v1' }));
    const res = await run(makeEvent(room.id, { contractId: null }));
    expect(res.status).toBe(200);
    expect(res.body.contractId).toBeNull();
  });
});
