import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  listAgentEventsInRoom,
  resetAgentTimelineStoreForTests
} from '$lib/server/agentTimelineStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): agent-events POST now requires
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'agent-events-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type CallOptions = {
  roomId: string;
  body?: string;
  withAuth?: boolean;
};

async function callPost(options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.withAuth !== false) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request('http://localhost/api/chat-rooms/x/agent-events', {
    method: 'POST',
    headers,
    body: options.body
  });
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL('http://localhost/api/chat-rooms/x/agent-events')
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

async function callGet(roomId: string): Promise<Response> {
  const request = new Request(`http://localhost/api/chat-rooms/${roomId}/agent-events`);
  const event = {
    request,
    params: { roomId },
    url: new URL(`http://localhost/api/chat-rooms/${roomId}/agent-events`)
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

describe('POST + GET /api/chat-rooms/:roomId/agent-events', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetAgentTimelineStoreForTests();
  });

  it('POST records an event and GET surfaces it (author must be a member)', async () => {
    const room = createChatRoom({ name: 'timeline-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
    const postResponse = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'batch_design wrote 22 nodes'
      })
    });
    expect(postResponse.status).toBe(201);

    const getResponse = await callGet(room.id);
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.agentEvents).toHaveLength(1);
    expect(getBody.agentEvents[0].summary).toBe('batch_design wrote 22 nodes');
  });

  it('POST returns 404 when the room id is unknown', async () => {
    const response = await callPost({
      roomId: 'does_not_exist',
      body: JSON.stringify({ authorHandle: '@a', kind: 'tool-call', summary: 'x' })
    });
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when the room id is unknown', async () => {
    const response = await callGet('does_not_exist');
    expect(response.status).toBe(404);
  });

  it('POST returns 400 when authorHandle is missing', async () => {
    const room = createChatRoom({ name: 'missing-author', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ kind: 'tool-call', summary: 'x' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 404 when authorHandle is not a member of the room and records nothing', async () => {
    const room = createChatRoom({ name: 'membership-check', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        authorHandle: '@stranger',
        kind: 'tool-call',
        summary: 'should not land'
      })
    });
    expect(response.status).toBe(404);
    expect(listAgentEventsInRoom(room.id)).toEqual([]);
  });

  it('POST normalises bare handles to @handle and accepts them when member', async () => {
    const room = createChatRoom({ name: 'normalise', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: 'kimi', kind: 'tool-call', summary: 'normalised' })
    });
    expect(response.status).toBe(201);
    const events = listAgentEventsInRoom(room.id);
    expect(events[0].authorHandle).toBe('@kimi');
  });

  it('POST returns 400 when summary is missing (after membership check passes)', async () => {
    const room = createChatRoom({ name: 'missing-summary', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@a', kind: 'tool-call' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when kind is not in the allowed enum (after membership check passes)', async () => {
    const room = createChatRoom({ name: 'bad-kind', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@a', kind: 'not-a-real-kind', summary: 'x' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'malformed', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: '{ broken' });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is a JSON array', async () => {
    const room = createChatRoom({ name: 'array', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is empty', async () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: '' });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when details is a non-object (array, number, string)', async () => {
    const room = createChatRoom({ name: 'bad-details', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    for (const badDetails of [['x'], 42, 'not an object']) {
      const response = await callPost({
        roomId: room.id,
        body: JSON.stringify({
          authorHandle: '@a',
          kind: 'tool-call',
          summary: 'x',
          details: badDetails
        })
      });
      expect(response.status).toBe(400);
    }
  });

  it('POST accepts details: undefined and details: a plain object', async () => {
    const room = createChatRoom({ name: 'good-details', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });

    const responseWithoutDetails = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@a', kind: 'tool-call', summary: 'no details' })
    });
    expect(responseWithoutDetails.status).toBe(201);

    const responseWithDetails = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        authorHandle: '@a',
        kind: 'tool-call',
        summary: 'with object details',
        details: { toolName: 'batch_design', count: 3 }
      })
    });
    expect(responseWithDetails.status).toBe(201);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-agent-event', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@a', kind: 'tool-call', summary: 'nope' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(listAgentEventsInRoom(room.id)).toEqual([]);
  });

  it('GET returns events in record order across kinds', async () => {
    const room = createChatRoom({ name: 'ordered', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@a', kind: 'tool-call', summary: 'first' })
    });
    await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@a', kind: 'plan-mode-entered', summary: 'second' })
    });
    const getResponse = await callGet(room.id);
    const getBody = await getResponse.json();
    expect(getBody.agentEvents.map((e: { summary: string }) => e.summary)).toEqual([
      'first',
      'second'
    ]);
  });
});
