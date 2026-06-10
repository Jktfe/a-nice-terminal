import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { resetChatMessageStoreForTests, listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resetPlanModeStoreForTests } from '$lib/server/planModeStore';
import { listArtefactsInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { getArtefactContentByArtefactId, resetChatRoomArtefactContentStoreForTests } from '$lib/server/chatRoomArtefactContentStore';
import { getTask, _resetTaskStoreForTests } from '$lib/server/taskStore';
import { composeStageSlides, listStageAlternatives } from '$lib/server/stageAlternativeStore';

const ADMIN_TOKEN_FOR_TESTS = 'stage-feedback-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => { process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS; });
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(deckId: string, body: unknown, opts: { withAuth?: boolean; password?: string } = { withAuth: true }): AnyEvent {
  const url = new URL(`http://localhost/api/decks/${deckId}/stage-feedback`);
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

describe('POST /api/decks/:deckId/stage-feedback', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetChatMessageStoreForTests();
    resetPlanModeStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomArtefactContentStoreForTests();
    _resetTaskStoreForTests();
  });

  it('publishes stage feedback and seeds an alternative proposal track', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      slides: [
        { id: 's1', title: 'Slide 1', content: 'Hello', speakerNotes: 'Say hello' },
        { id: 's2', title: 'Slide 2', content: 'Next claim', speakerNotes: 'Say next claim' }
      ]
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
    expect(body.proposal.ref).toMatch(/^\/artefacts\//);
    expect(body.proposal.taskIds).toHaveLength(3);
    expect(body.generatedAlternatives).toBe(2);

    const alternatives = listStageAlternatives(deck.id);
    expect(alternatives).toHaveLength(2);
    expect(alternatives[0].decision?.action).toBe('replace-slide');
    const composed = composeStageSlides(deck, alternatives);
    expect(composed[0]).toMatchObject({
      source: 'alternative',
      sourceAlternativeRef: alternatives[0].ref
    });

    const messages = listMessagesInRoom(room.id);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].kind).toBe('human');
    expect(messages[0].body).toContain('Stage feedback');
    expect(messages[0].body).toContain('No, we do not do that');
    expect(messages[0].body).toContain('Alternative Track (/artefacts/');

    const artefacts = listArtefactsInRoom(room.id);
    expect(artefacts).toHaveLength(1);
    expect(artefacts[0]).toMatchObject({
      kind: 'doc',
      title: 'Alternative Track: Stage Deck / slide 1'
    });
    const content = getArtefactContentByArtefactId(artefacts[0].id);
    expect(content?.contentBody).toContain('## User Feedback');
    expect(content?.contentBody).toContain('No, we do not do that');
    expect(content?.contentBody).toContain('## Agent Work Required');
    expect(content?.contentBody).toContain('## Alternative Shapes');
    expect(content?.contentBody).toContain('### Replace slide');
    expect(content?.contentBody).not.toContain('FCA');

    const task = getTask(body.proposal.taskIds[0]);
    expect(task).not.toBeNull();
    expect(task?.planId).toBe(`stage-${deck.id}`);
    expect(task?.evidence[0]).toMatchObject({
      kind: 'proposal',
      ref: `/artefacts/${artefacts[0].id}#shape-replace`,
      label: 'Replace slide: Alternative Track: Stage Deck / slide 1'
    });
  });

  it('allows a deck-password presenter to submit feedback without room auth', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello', speakerNotes: 'Say hello' }]
    });

    const response = await runPost(eventFor(deck.id, {
      slideIndex: 0,
      feedbackText: 'This should go to the hidden Stage discussion.',
      pasteContext: 'Presenter supplied context.'
    }, { withAuth: false, password: 'stage-demo' }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.proposal.ref).toMatch(/^\/artefacts\//);

    const messages = listMessagesInRoom(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('This should go to the hidden Stage discussion.');
  });

  it('rejects a wrong deck password for feedback submission', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });

    const response = await runPost(eventFor(deck.id, {
      slideIndex: 0,
      feedbackText: 'Should not land.'
    }, { withAuth: false, password: 'wrong' }));

    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toEqual([]);
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
