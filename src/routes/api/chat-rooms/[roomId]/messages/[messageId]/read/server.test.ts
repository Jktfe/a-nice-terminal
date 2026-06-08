import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import {
  listReadersForMessage,
  resetMessageReadReceiptStoreForTests
} from '$lib/server/messageReadReceiptStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createSession } from '$lib/server/antSessionStore';
import { addMember } from '$lib/server/membershipStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { subscribeToRoom, unsubscribeFromRoom } from '$lib/server/eventBroadcast';

type PostOptions = {
  roomId: string;
  messageId: string;
  body?: string;
  cookie?: string;
  sessionId?: string;
};

async function callPost(options: PostOptions): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${options.roomId}/messages/${options.messageId}/read`;
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie !== undefined && { cookie: options.cookie }),
      ...(options.sessionId !== undefined && { 'x-ant-session-id': options.sessionId })
    },
    body: options.body
  });
  const event = {
    request,
    params: { roomId: options.roomId, messageId: options.messageId },
    url: new URL(url)
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

async function callGet(roomId: string, messageId: string): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/messages/${messageId}/read`;
  const event = {
    request: new Request(url),
    params: { roomId, messageId },
    url: new URL(url)
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

let callerSeed = 0;
function verifiedReader(roomId: string, handle: string) {
  callerSeed += 1;
  const pid = 20_000 + callerSeed;
  const pid_start = `reader-pid-start-${callerSeed}`;
  const terminal = upsertTerminal({
    pid,
    pid_start,
    name: `reader-${handle.replace(/^@/, '')}-${callerSeed}`
  });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return { readerHandle: handle, pidChain: [{ pid, pid_start }] };
}

function browserReaderCookie(roomId: string, handle: string): string {
  const terminal = upsertTerminal({
    pid: 0,
    pid_start: `browser-reader-${handle}-${callerSeed += 1}`,
    name: `browser-reader-${handle.replace(/^@/, '')}`
  });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  const session = createBrowserSession({ roomId, authorHandle: handle });
  if (!session) throw new Error('expected browser session');
  return `ant_browser_session=${session.browserSessionSecret}`;
}

describe('POST + GET /api/chat-rooms/:roomId/messages/:messageId/read', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetMessageReadReceiptStoreForTests();
    resetIdentityDbForTests();
  });

  it('POST records a read and GET lists it', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hello'
    });

    const postResponse = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@kimi'))
    });
    expect(postResponse.status).toBe(201);

    const getResponse = await callGet(room.id, message.id);
    expect(getResponse.status).toBe(200);
    const body = await getResponse.json();
    expect(body.readers).toHaveLength(1);
    expect(body.readers[0].readerHandle).toBe('@kimi');
  });

  it('POST broadcasts a message_read event with the current reader list', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hello'
    });
    const emitted: unknown[] = [];
    const decoder = new TextDecoder();
    const controller = {
      enqueue(chunk: Uint8Array) {
        const text = decoder.decode(chunk);
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try { emitted.push(JSON.parse(line.slice(6))); }
            catch { /* not JSON; skip */ }
          }
        }
      }
    } as ReadableStreamDefaultController<Uint8Array>;
    subscribeToRoom(room.id, controller);

    try {
      const postResponse = await callPost({
        roomId: room.id,
        messageId: message.id,
        body: JSON.stringify(verifiedReader(room.id, '@kimi'))
      });
      expect(postResponse.status).toBe(201);
      expect(emitted).toContainEqual(expect.objectContaining({
        type: 'message_read',
        roomId: room.id,
        messageId: message.id,
        readerHandle: '@kimi',
        readers: expect.arrayContaining([
          expect.objectContaining({ messageId: message.id, readerHandle: '@kimi' })
        ])
      }));
    } finally {
      unsubscribeFromRoom(room.id, controller);
    }
  });

  it('POST is idempotent — second read by the same handle does not duplicate', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hello'
    });

    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@kimi'))
    });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@kimi'))
    });
    expect(listReadersForMessage(message.id)).toHaveLength(1);
  });

  it('POST normalises a bare handle to @handle and accepts padding', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bob' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });

    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ ...verifiedReader(room.id, '@bob'), readerHandle: '   bob   ' })
    });
    expect(response.status).toBe(201);
    expect(listReadersForMessage(message.id)[0].readerHandle).toBe('@bob');
  });

  it('POST returns 404 when the room is unknown', async () => {
    const response = await callPost({
      roomId: 'no_such_room',
      messageId: 'msg_x',
      body: JSON.stringify(verifiedReader('no_such_room', '@you'))
    });
    expect(response.status).toBe(404);
  });

  it('POST returns 404 when the message is not in this room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@reader' });
    const messageInA = postMessage({
      roomId: roomA.id,
      authorHandle: '@you',
      body: 'secret'
    });
    const response = await callPost({
      roomId: roomB.id,
      messageId: messageInA.id,
      body: JSON.stringify(verifiedReader(roomB.id, '@reader'))
    });
    expect(response.status).toBe(404);
    expect(listReadersForMessage(messageInA.id)).toEqual([]);
  });

  it('POST rejects unresolved callers before trusting readerHandle membership', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ readerHandle: '@stranger' })
    });
    expect(response.status).toBe(403);
    expect(listReadersForMessage(message.id)).toEqual([]);
  });

  it('POST returns 404 when resolved reader is not a chat-room member', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@identity-only'))
    });
    expect(response.status).toBe(404);
    expect(listReadersForMessage(message.id)).toEqual([]);
  });

  it('POST records the server-resolved pidChain reader when readerHandle is omitted', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@a'))
    });
    expect(response.status).toBe(201);
    expect(listReadersForMessage(message.id)[0].readerHandle).toBe('@a');
  });

  it('POST records the durable-session reader when pidChain has no legacy room membership', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@durable' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const terminal = upsertTerminal({
      pid: 41_000,
      pid_start: 'durable-reader-start',
      name: 'durable-reader'
    });
    const session = createSession({
      id: 'sess-reader-durable',
      kind: 'local-cli',
      label: '@durable',
      terminalId: terminal.id
    });
    addMember(room.id, '@durable', session.id);

    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      sessionId: session.id,
      body: JSON.stringify({ pidChain: [{ pid: 41_000, pid_start: 'durable-reader-start' }] })
    });

    expect(response.status).toBe(201);
    expect(listReadersForMessage(message.id)[0].readerHandle).toBe('@durable');
  });

  it('POST records the browser-session reader when readerHandle is omitted', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@JWPK' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@JWPK',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      cookie: browserReaderCookie(room.id, '@JWPK'),
      body: JSON.stringify({})
    });
    expect(response.status).toBe(201);
    expect(listReadersForMessage(message.id)[0].readerHandle).toBe('@JWPK');
  });

  it('POST rejects when claimed readerHandle does not match pidChain identity', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ ...verifiedReader(room.id, '@a'), readerHandle: '@b' })
    });
    expect(response.status).toBe(403);
    expect(listReadersForMessage(message.id)).toEqual([]);
  });

  it('POST rejects unresolved callers instead of trusting readerHandle', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ readerHandle: '@a' })
    });
    expect(response.status).toBe(403);
    expect(listReadersForMessage(message.id)).toEqual([]);
  });

  it('POST returns 400 when body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: '{ broken'
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is a JSON array', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is empty', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: ''
    });
    expect(response.status).toBe(400);
  });

  it('GET returns 404 when room is unknown', async () => {
    const response = await callGet('does_not_exist', 'msg_x');
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when message is not in this room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    const messageInA = postMessage({
      roomId: roomA.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callGet(roomB.id, messageInA.id);
    expect(response.status).toBe(404);
  });

  it('GET returns 200 with empty readers when nobody has read yet', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callGet(room.id, message.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readers).toEqual([]);
  });

  it('GET returns readers in mark-order', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@one' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@two' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hi'
    });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@one'))
    });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(verifiedReader(room.id, '@two'))
    });
    const response = await callGet(room.id, message.id);
    const body = await response.json();
    expect(body.readers.map((entry: { readerHandle: string }) => entry.readerHandle)).toEqual([
      '@one',
      '@two'
    ]);
  });
});
