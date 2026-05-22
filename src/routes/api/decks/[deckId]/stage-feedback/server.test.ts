import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { resetChatMessageStoreForTests, listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resetPlanModeStoreForTests } from '$lib/server/planModeStore';

const ADMIN_TOKEN_FOR_TESTS = 'stage-feedback-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => { process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS; });
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(deckId: string, body: unknown): AnyEvent {
  const url = new URL(`http://localhost/api/decks/${deckId}/stage-feedback`);
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` },
      body: JSON.stringify(body)
    }),
    params: { deckId },
    url
  } as unknown as AnyEvent;
}

async function runPost(event: AnyEvent): Promise<Response> {
  try { return (await POST(event)) as Response; }
  catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('POST /api/decks/:deckId/stage-feedback', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetChatMessageStoreForTests();
    resetPlanModeStoreForTests();
  });

  it('publishes a stage_feedback plan event and room message', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello', speakerNotes: 'Say hello' }]
    });

    const response = await runPost(eventFor(deck.id, {
      slideIndex: 0,
      feedbackText: 'No, we do not do that. We do this.',
      pasteContext: 'Revised approach: X instead of Y.'
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.slideIndex).toBe(0);
    expect(body.ref).toContain('stage:');

    const messages = listMessagesInRoom(room.id);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].kind).toBe('system');
    expect(messages[0].body).toContain('Stage feedback');
    expect(messages[0].body).toContain('No, we do not do that');
  });

  it('rejects empty feedback text', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });

    const response = await runPost(eventFor(deck.id, { slideIndex: 0, feedbackText: '   ' }));
    expect(response.status).toBe(400);
  });
});
