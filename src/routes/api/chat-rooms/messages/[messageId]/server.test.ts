import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { GET } from './+server';

type AnyHandler = (event: unknown) => unknown;

let callerSeed = 0;
function verifiedCaller(roomId: string, handle = '@agent') {
  callerSeed += 1;
  const pid = 20_000 + callerSeed;
  const pid_start = `message-lookup-pid-start-${callerSeed}`;
  const terminal = upsertTerminal({
    pid,
    pid_start,
    name: `lookup-${handle.replace(/^@/, '')}-${callerSeed}`
  });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return { pidChain: [{ pid, pid_start }] };
}

function eventFor(messageId: string, pidChain?: unknown[]) {
  const url = new URL(`http://localhost/api/chat-rooms/messages/${messageId}`);
  if (pidChain) url.searchParams.set('pidChain', JSON.stringify(pidChain));
  return {
    request: new Request(url),
    url,
    params: { messageId }
  } as unknown as Parameters<typeof GET>[0];
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  callerSeed = 0;
});

describe('GET /api/chat-rooms/messages/:messageId', () => {
  it('returns a message when the caller can read its room', async () => {
    const room = createChatRoom({ name: 'lookup-room', whoCreatedIt: '@you' });
    const parent = postMessage({ roomId: room.id, authorHandle: '@you', body: 'question' });
    const caller = verifiedCaller(room.id, '@agent');

    const response = await run(GET as unknown as AnyHandler, eventFor(parent.id, caller.pidChain));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.message).toMatchObject({
      id: parent.id,
      roomId: room.id,
      authorHandle: '@you',
      body: 'question'
    });
  });

  it('401s without a readable-room identity', async () => {
    const room = createChatRoom({ name: 'lookup-private', whoCreatedIt: '@you' });
    const parent = postMessage({ roomId: room.id, authorHandle: '@you', body: 'secret' });

    const response = await run(GET as unknown as AnyHandler, eventFor(parent.id));

    expect(response.status).toBe(401);
  });

  it('404s for an unknown message id', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('msg_missing'));

    expect(response.status).toBe(404);
  });
});
