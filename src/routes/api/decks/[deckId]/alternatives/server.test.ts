import { describe, expect, it, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { appendPlanEvent, resetPlanModeStoreForTests } from '$lib/server/planModeStore';
import { createTask, _resetTaskStoreForTests } from '$lib/server/taskStore';
import { appendStageAlternativeDecision, listStageAlternatives } from '$lib/server/stageAlternativeStore';

function postEventFor(deckId: string, body: unknown, password?: string): Parameters<typeof POST>[0] {
  const url = new URL(`http://localhost/api/decks/${deckId}/alternatives`);
  if (password) url.searchParams.set('password', password);
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    params: { deckId },
    url
  } as unknown as Parameters<typeof POST>[0];
}

async function runPost(event: Parameters<typeof POST>[0]): Promise<Response> {
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

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(deckId: string, password?: string): AnyEvent {
  const url = new URL(`http://localhost/api/decks/${deckId}/alternatives`);
  if (password) url.searchParams.set('password', password);
  return {
    request: new Request(url.toString()),
    params: { deckId },
    url
  } as unknown as AnyEvent;
}

async function runGet(event: AnyEvent): Promise<Response> {
  try { return (await GET(event)) as Response; }
  catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('GET /api/decks/:deckId/alternatives', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetPlanModeStoreForTests();
    _resetTaskStoreForTests();
  });

  it('requires normal deck access', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });

    const response = await runGet(eventFor(deck.id));

    expect(response.status).toBe(403);
  });

  it('returns proposal tracks and generated slide alternatives for a password deck viewer', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [
        { id: 's1', title: 'Slide 1', content: 'Hello' },
        { id: 's2', title: 'Slide 2', content: 'Original downstream' }
      ]
    });
    createTask({
      id: 'task-alt-poc',
      subject: 'Alternative Track: Stage Deck / slide 1 (POC)',
      description: 'POC frame',
      planId: `stage-${deck.id}`,
      evidence: [{ kind: 'proposal', ref: '/artefacts/art-1#lens-poc', label: 'POC: Alternative Track' }],
      startedAtMs: 1000
    });
    appendPlanEvent({
      id: 'evt-alt-1',
      plan_id: `stage-${deck.id}`,
      kind: 'plan_decision',
      title: 'Alternative for slide 2: Better path',
      body: 'Feedback changes the next slide.',
      order: 1,
      author_handle: '@agent',
      author_kind: 'agent',
      ts_millis: 2000,
      evidence: [{
        kind: 'stage_alternative',
        ref: `alt:${deck.id}:slide:1:2000`,
        label: 'alt-for:stage-ref',
        narration: JSON.stringify({
          originalTitle: 'Slide 2',
          proposedTitle: 'Better path',
          proposedContent: 'Generated downstream alternative',
          proposedSpeakerNotes: 'Say the better path.'
        })
      }]
    });
    appendStageAlternativeDecision({
      deckId: deck.id,
      alternativeRef: `alt:${deck.id}:slide:1:2000`,
      action: 'append-appendix',
      decidedBy: '@you',
      nowMs: 3000
    });

    const response = await runGet(eventFor(deck.id, 'stage-demo'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'proposal',
        slideIndex: 0,
        ref: '/artefacts/art-1#lens-poc',
        lens: 'POC'
      }),
      expect.objectContaining({
        kind: 'slide',
        slideIndex: 1,
        proposedTitle: 'Better path',
        proposedContent: 'Generated downstream alternative',
        feedbackRef: 'stage-ref',
        decision: expect.objectContaining({ action: 'append-appendix' })
      })
    ]));
  });
});

describe('POST /api/decks/:deckId/alternatives (agent-authored, JWPK "deliver the magic")', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
    resetPlanModeStoreForTests();
    _resetTaskStoreForTests();
  });

  it('persists an agent-authored alternative that then surfaces via GET (live alt-track)', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [
        { id: 's1', title: 'Slide 1', content: 'Hello' },
        { id: 's2', title: 'Slide 2', content: 'Original' }
      ]
    });

    const res = await runPost(
      postEventFor(
        deck.id,
        { slideNumber: 2, proposedTitle: 'Slide 2 — concrete before/after', proposedContent: 'Before: X. After: Y.' },
        'stage-demo'
      )
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; slideIndex: number };
    expect(body.ok).toBe(true);
    expect(body.slideIndex).toBe(1);

    const alts = listStageAlternatives(deck.id);
    expect(alts.some((a) => a.proposedTitle === 'Slide 2 — concrete before/after')).toBe(true);
  });

  it('rejects an authored alternative without presenter auth', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });
    const res = await runPost(
      postEventFor(deck.id, { slideNumber: 1, proposedTitle: 'x', proposedContent: 'y' })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a slide index outside the deck', async () => {
    const room = createChatRoom({ name: 'stage room', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Stage Deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Hello' }]
    });
    const res = await runPost(
      postEventFor(deck.id, { slideNumber: 9, proposedTitle: 'x', proposedContent: 'y' }, 'stage-demo')
    );
    expect(res.status).toBe(400);
  });
});
