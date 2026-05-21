import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  answerAsk,
  listAllOpenAsks,
  resetAskStoreForTests
} from '$lib/server/askStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import { issueToken, resetAntchatAuthTokensForTests } from '$lib/server/antchatAuthStore';

type CallPostOptions = { body?: string };

async function asResponse(
  produceResponse: () => Response | Promise<Response> | unknown
): Promise<Response> {
  try {
    return (await produceResponse()) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

async function callPost(options: CallPostOptions): Promise<Response> {
  const url = 'http://localhost/api/asks';
  return asResponse(() => {
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: options.body
    });
    const event = {
      request,
      params: {},
      url: new URL(url)
    } as unknown as Parameters<typeof POST>[0];
    return POST(event);
  });
}

async function callGet(rawSearch: string = '', headers?: Record<string, string>): Promise<Response> {
  const url = `http://localhost/api/asks${rawSearch}`;
  const requestHeaders = headers ?? {
    authorization: `Bearer ${issueToken('you@example.com').token}`
  };
  return asResponse(() => {
    const event = {
      request: new Request(url, { headers: requestHeaders }),
      params: {},
      url: new URL(url)
    } as unknown as Parameters<typeof GET>[0];
    return GET(event);
  });
}

async function assertNoAskRecorded(): Promise<void> {
  expect(listAllOpenAsks()).toEqual([]);
  const response = await callGet();
  const body = await response.json();
  expect(body.asks).toEqual([]);
}

describe('POST + GET /api/asks', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetAntchatAuthTokensForTests();
    resetAskStoreForTests();
  });

  it('GET rejects unauthenticated reads', async () => {
    const response = await callGet('', {});

    expect(response.status).toBe(401);
  });

  it('Asks principle (JWPK msg_86qcfvbkur 2026-05-19): agent handles cannot open user-facing asks', async () => {
    // Open Asks queue is the user's decision inbox. Agents must use
    // POST /api/tasks for internal tracking. See
    // audits/2026-05-19-asks-principle-user-only.md.
    const room = createChatRoom({ name: 'agent-pollution', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantux' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@evolveantux',
        title: 'Internal tracking that should NOT pollute user queue',
        body: 'agent-filed item'
      })
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/Agent handles cannot open user-facing asks/);
    const getResponse = await callGet();
    const getBody = await getResponse.json();
    expect(getBody.asks).toHaveLength(0);
  });

  it('POST opens an ask and GET surfaces it', async () => {
    const room = createChatRoom({ name: 'asks-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const postResponse = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@kimi',
        title: 'shall we ship?',
        body: 'all tests pass'
      })
    });
    expect(postResponse.status).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.ask.status).toBe('open');
    expect(postBody.ask.openedByHandle).toBe('@kimi');

    const getResponse = await callGet();
    const getBody = await getResponse.json();
    expect(getBody.asks).toHaveLength(1);
    expect(getBody.asks[0].id).toBe(postBody.ask.id);
  });

  it('GET with ?roomId scopes the list to that room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    await callPost({
      body: JSON.stringify({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: 'A',
        body: 'in A'
      })
    });
    await callPost({
      body: JSON.stringify({
        roomId: roomB.id,
        openedByHandle: '@you',
        title: 'B',
        body: 'in B'
      })
    });
    const response = await callGet(`?roomId=${roomA.id}`);
    const body = await response.json();
    expect(body.asks).toHaveLength(1);
    expect(body.asks[0].roomId).toBe(roomA.id);
  });

  it('GET returns 404 for an unknown roomId', async () => {
    const response = await callGet('?roomId=does_not_exist');
    expect(response.status).toBe(404);
  });

  it('GET with whitespace ?roomId falls back to all-rooms list', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@you',
        title: 't',
        body: 'b'
      })
    });
    const response = await callGet('?roomId=%20%20');
    const body = await response.json();
    expect(body.asks).toHaveLength(1);
  });

  it('POST returns 400 for malformed JSON — no ask recorded', async () => {
    const response = await callPost({ body: '{ broken' });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for empty body — no ask recorded', async () => {
    const response = await callPost({ body: '' });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for JSON array body — no ask recorded', async () => {
    const response = await callPost({ body: JSON.stringify(['nope']) });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for missing roomId — no ask recorded', async () => {
    const response = await callPost({
      body: JSON.stringify({
        openedByHandle: '@you',
        title: 't',
        body: 'b'
      })
    });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 404 for unknown roomId — no ask recorded', async () => {
    const response = await callPost({
      body: JSON.stringify({
        roomId: 'does_not_exist',
        openedByHandle: '@you',
        title: 't',
        body: 'b'
      })
    });
    expect(response.status).toBe(404);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for missing openedByHandle — no ask recorded', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        title: 't',
        body: 'b'
      })
    });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for whitespace-only openedByHandle — no ask recorded', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '   ',
        title: 't',
        body: 'b'
      })
    });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 404 for non-member openedByHandle — no ask recorded', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@stranger',
        title: 't',
        body: 'b'
      })
    });
    expect(response.status).toBe(404);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for blank title — no ask recorded', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@you',
        title: '   ',
        body: 'b'
      })
    });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST returns 400 for blank body — no ask recorded', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@you',
        title: 't',
        body: '   '
      })
    });
    expect(response.status).toBe(400);
    await assertNoAskRecorded();
  });

  it('POST normalises bare handle to @handle', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bob' });
    const response = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '  bob  ',
        title: 't',
        body: 'b'
      })
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ask.openedByHandle).toBe('@bob');
  });

  it('GET returns 200 with empty asks when nothing has been opened', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.asks).toEqual([]);
    expect(body.candidates).toEqual([]);
  });

  it('GET retro-backfills ask candidates from recent @you and hands-up chat signals', async () => {
    const room = createChatRoom({ name: 'signals', whoCreatedIt: '@you' });
    postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@you please decide this'
    });
    postMessage({
      roomId: room.id,
      authorHandle: '@svelte',
      body: 'raising hand 🙌'
    });
    postMessage({
      roomId: room.id,
      authorHandle: '@kimi',
      body: 'informational [@you] should not count'
    });

    const response = await callGet();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.asks).toEqual([]);
    expect(body.candidates.map((candidate: { sourceType: string }) => candidate.sourceType)).toEqual([
      'mention',
      'emoji-message'
    ]);

    const scopedResponse = await callGet(`?roomId=${room.id}`);
    const scopedBody = await scopedResponse.json();
    expect(scopedBody.candidates).toHaveLength(2);
  });

  it('GET /api/asks default returns asks in global insertion order across rooms (not room-grouped)', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    await callPost({
      body: JSON.stringify({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: 'first-A',
        body: 'b'
      })
    });
    await callPost({
      body: JSON.stringify({
        roomId: roomB.id,
        openedByHandle: '@you',
        title: 'second-B',
        body: 'b'
      })
    });
    await callPost({
      body: JSON.stringify({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: 'third-A',
        body: 'b'
      })
    });
    const response = await callGet();
    const body = await response.json();
    expect(body.asks.map((ask: { title: string }) => ask.title)).toEqual([
      'first-A',
      'second-B',
      'third-A'
    ]);
  });

  it('GET surfaces answered asks as recentlyAnswered while keeping asks open-only', async () => {
    const room = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const openResponse = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'still-open',
        body: 'b'
      })
    });
    const answeredResponse = await callPost({
      body: JSON.stringify({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'answered-decision',
        body: 'b'
      })
    });
    const answeredAsk = (await answeredResponse.json()).ask as { id: string };
    answerAsk({ askId: answeredAsk.id, answeredByHandle: '@you', answer: 'yes' });

    const response = await callGet();
    const body = await response.json();
    expect(body.asks.map((ask: { title: string }) => ask.title)).toEqual(['still-open']);
    expect(body.recentlyAnswered.map((ask: { title: string }) => ask.title)).toEqual([
      'answered-decision'
    ]);

    const openAsk = (await openResponse.json()).ask as { id: string };
    expect(body.recentlyAnswered.map((ask: { id: string }) => ask.id)).not.toContain(openAsk.id);
  });

  it('GET with ?roomId scopes recentlyAnswered to the requested room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    const askAResponse = await callPost({
      body: JSON.stringify({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: 'answered-A',
        body: 'b'
      })
    });
    const askBResponse = await callPost({
      body: JSON.stringify({
        roomId: roomB.id,
        openedByHandle: '@you',
        title: 'answered-B',
        body: 'b'
      })
    });
    answerAsk({
      askId: ((await askAResponse.json()).ask as { id: string }).id,
      answeredByHandle: '@you',
      answer: 'A'
    });
    answerAsk({
      askId: ((await askBResponse.json()).ask as { id: string }).id,
      answeredByHandle: '@you',
      answer: 'B'
    });

    const response = await callGet(`?roomId=${roomA.id}`);
    const body = await response.json();
    expect(body.asks).toEqual([]);
    expect(body.recentlyAnswered.map((ask: { title: string }) => ask.title)).toEqual([
      'answered-A'
    ]);
  });
});
