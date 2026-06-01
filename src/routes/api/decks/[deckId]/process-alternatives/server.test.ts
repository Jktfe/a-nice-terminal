import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { resetPlanModeStoreForTests } from '$lib/server/planModeStore';

const ADMIN_TOKEN_FOR_TESTS = 'process-alternatives-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => { process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS; });
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(deckId: string, opts: { withAuth?: boolean; password?: string } = { withAuth: true }): AnyEvent {
  const url = new URL(`http://localhost/api/decks/${deckId}/process-alternatives`);
  if (opts.password) url.searchParams.set('password', opts.password);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.withAuth ?? true) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({})
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

describe('POST /api/decks/:deckId/process-alternatives', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetPlanModeStoreForTests();
  });

  it('returns 404 when deck does not exist', async () => {
    const response = await runPost(eventFor('missing'));
    expect(response.status).toBe(404);
  });

  it('allows a deck-password presenter to process alternatives without room auth', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });

    const response = await runPost(eventFor(deck.id, { withAuth: false, password: 'stage-demo' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.deckId).toBe(deck.id);
  });

  it('rejects a wrong deck password', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });

    const response = await runPost(eventFor(deck.id, { withAuth: false, password: 'wrong' }));

    expect(response.status).toBe(403);
  });
});
