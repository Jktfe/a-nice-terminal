import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { resetChatMessageStoreForTests, listMessagesInRoom } from '$lib/server/chatMessageStore';
import { subscribeRoomEvents } from '$lib/server/eventBroadcast';
import { resetPlanModeStoreForTests } from '$lib/server/planModeStore';
import { getCurrentFocus } from '$lib/server/stageStore';

const ADMIN_TOKEN_FOR_TESTS = 'stage-focus-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(deckId: string, body: unknown, withAuth = true): AnyEvent {
  const url = new URL(`http://localhost/api/decks/${deckId}/stage-focus`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return { request, params: { deckId }, url } as unknown as AnyEvent;
}

async function runPost(event: AnyEvent): Promise<Response> {
  try {
    return (await POST(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('POST /api/decks/:deckId/stage-focus', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetChatMessageStoreForTests();
    resetPlanModeStoreForTests();
  });

  it('publishes the focused slide into stageStore and the room fanout', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Pitch',
      slides: [
        { id: 's1', title: 'Opening', content: 'One' },
        { id: 's2', title: 'Evidence', content: 'Two' }
      ]
    });
    const broadcastEvents: Record<string, unknown>[] = [];
    const unsubscribe = subscribeRoomEvents(room.id, (event) => {
      broadcastEvents.push(event);
    });

    try {
      const response = await runPost(eventFor(deck.id, {
        planId: 'stage-primitive-v1',
        slideId: 's2',
        slideIndex: 1,
        slideTitle: 'Evidence'
      }));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.focus).toMatchObject({
        stageId: deck.id,
        ref: `stage:${deck.id}:slide:s2`,
        label: 'Slide 2: Evidence',
        source: 'plan_event'
      });
    } finally {
      unsubscribe();
    }

    expect(getCurrentFocus(deck.id)).toMatchObject({
      ref: `stage:${deck.id}:slide:s2`,
      label: 'Slide 2: Evidence'
    });
    const messages = listMessagesInRoom(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('system');
    expect(messages[0].body).toContain('Stage focus: Stage Pitch');
    expect(messages[0].body).toContain('Slide 2: Evidence');
    expect(broadcastEvents).toHaveLength(1);
    expect(broadcastEvents[0]).toMatchObject({
      type: 'message_added',
      message: messages[0]
    });
  });

  it('rejects unauthenticated focus publishes without creating focus evidence', async () => {
    const room = createChatRoom({ name: 'private stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Private Stage',
      slides: [{ id: 's1', title: 'Opening', content: 'One' }]
    });

    const response = await runPost(eventFor(deck.id, {
      planId: 'stage-primitive-v1',
      slideId: 's1',
      slideIndex: 0,
      slideTitle: 'Opening'
    }, false));

    expect(response.status).toBe(401);
    expect(getCurrentFocus(deck.id)).toBeNull();
    expect(listMessagesInRoom(room.id)).toEqual([]);
  });
});
