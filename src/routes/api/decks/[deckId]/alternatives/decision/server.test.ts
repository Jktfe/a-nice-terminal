import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { appendPlanEvent, resetPlanModeStoreForTests } from '$lib/server/planModeStore';
import { listStageAlternatives } from '$lib/server/stageAlternativeStore';

const ADMIN_TOKEN_FOR_TESTS = 'stage-alternative-decision-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => { process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS; });
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(deckId: string, body: unknown, opts: { withAuth?: boolean; password?: string } = { withAuth: true }): AnyEvent {
  const url = new URL(`http://localhost/api/decks/${deckId}/alternatives/decision`);
  if (opts.password) url.searchParams.set('password', opts.password);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.withAuth ?? true) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
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

function makeDeckWithAlternative() {
  const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
  const deck = createDeck({
    roomId: room.id,
    title: 'Stage Deck',
    accessPassword: 'stage-demo',
    slides: [{ id: 's1', title: 'Slide 1', content: 'Original' }]
  });
  appendPlanEvent({
    id: 'evt-alt-1',
    plan_id: `stage-${deck.id}`,
    kind: 'plan_decision',
    title: 'Alternative for slide 1: Better',
    body: 'Answers feedback.',
    order: 0,
    author_handle: '@agent',
    author_kind: 'agent',
    ts_millis: 1000,
    evidence: [{
      kind: 'stage_alternative',
      ref: `alt:${deck.id}:slide:0:1000`,
      label: 'alt-for:feedback-ref-1',
      narration: JSON.stringify({
        originalTitle: 'Slide 1',
        proposedTitle: 'Better',
        proposedContent: 'Replacement',
        proposedSpeakerNotes: 'Say replacement.'
      })
    }]
  });
  return deck;
}

describe('POST /api/decks/:deckId/alternatives/decision', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetPlanModeStoreForTests();
  });

  it('records a presenter decision for an existing slide alternative', async () => {
    const deck = makeDeckWithAlternative();
    const alternative = listStageAlternatives(deck.id)[0];

    const response = await runPost(eventFor(deck.id, {
      alternativeRef: alternative.ref,
      action: 'replace-slide'
    }, { withAuth: false, password: 'stage-demo' }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.decision).toMatchObject({
      alternativeRef: alternative.ref,
      action: 'replace-slide'
    });
    expect(listStageAlternatives(deck.id)[0].decision).toMatchObject({
      action: 'replace-slide'
    });
  });

  it('rejects decisions for unknown alternative refs', async () => {
    const deck = makeDeckWithAlternative();

    const response = await runPost(eventFor(deck.id, {
      alternativeRef: 'alt:not-real',
      action: 'replace-slide'
    }, { withAuth: false, password: 'stage-demo' }));

    expect(response.status).toBe(404);
  });

  it('rejects invalid actions', async () => {
    const deck = makeDeckWithAlternative();
    const alternative = listStageAlternatives(deck.id)[0];

    const response = await runPost(eventFor(deck.id, {
      alternativeRef: alternative.ref,
      action: 'ship-it'
    }, { withAuth: false, password: 'stage-demo' }));

    expect(response.status).toBe(400);
  });
});
