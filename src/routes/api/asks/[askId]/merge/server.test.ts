/**
 * Endpoint tests for POST /api/asks/:askId/merge — premium-stub for the
 * Chair feature. Source ask → 'merged', into ask untouched, both still
 * keep the askee's response-required pill lit.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  openAskInRoom,
  answerAsk,
  findAskById,
  resetAskStoreForTests,
  RESPONSE_REQUIRED_STATUSES,
  hasResponseRequiredAsksForHandle
} from '$lib/server/askStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'ask-merge-test-admin';

function eventFor(askId: string, body: unknown, authenticated = true) {
  const url = new URL(`http://localhost/api/asks/${askId}/merge`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    params: { askId },
    url
  } as unknown as Parameters<typeof POST>[0];
}

async function runHandler(event: Parameters<typeof POST>[0]): Promise<Response> {
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

function setupTwoAsksForJames() {
  resetChatRoomStoreForTests();
  resetAskStoreForTests();
  const room = createChatRoom({ name: 'merge-room', whoCreatedIt: '@you' });
  inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr-codex' });
  inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr-claude' });
  const a = openAskInRoom({
    roomId: room.id, openedByHandle: '@askr-codex', targetHandle: '@you',
    title: 'q a', body: 'codex asks something'
  });
  const b = openAskInRoom({
    roomId: room.id, openedByHandle: '@askr-claude', targetHandle: '@you',
    title: 'q b', body: 'claude asks something similar'
  });
  return { roomId: room.id, source: a, into: b };
}

describe('POST /api/asks/:askId/merge', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('rejects anonymous merges before mutation', async () => {
    const { source, into } = setupTwoAsksForJames();
    const response = await runHandler(eventFor(source.id, {
      intoAskId: into.id,
      mergedByHandle: '@you'
    }, false));
    expect(response.status).toBe(401);
    expect(findAskById(source.id)?.status).toBe('open');
  });

  it('merges source into into; source becomes "merged" with audit fields', async () => {
    const { source, into } = setupTwoAsksForJames();
    const response = await runHandler(eventFor(source.id, {
      intoAskId: into.id,
      mergedByHandle: '@you'
    }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ask: { status: string; mergedIntoAskId?: string; mergedByHandle?: string } };
    expect(body.ask.status).toBe('merged');
    expect(body.ask.mergedIntoAskId).toBe(into.id);
    expect(body.ask.mergedByHandle).toBe('@you');
  });

  it('merged status keeps the pill lit — RESPONSE_REQUIRED_STATUSES includes "merged"', async () => {
    expect(RESPONSE_REQUIRED_STATUSES).toContain('merged');
    const { source, into } = setupTwoAsksForJames();
    await runHandler(eventFor(source.id, { intoAskId: into.id, mergedByHandle: '@you' }));
    expect(hasResponseRequiredAsksForHandle('@you')).toBe(true);
    // Answer the into; the merged source no longer matters because the into is closed.
    // But @you still has the merged row in {open,merged} — wait, merged keeps it lit.
    answerAsk({ askId: into.id, answeredByHandle: '@you', answer: 'answered both via the into' });
    // Source is still 'merged' (not answered), so pill stays lit unless ops dismiss
    // the merged row. Documented behaviour — the chair decides.
    expect(hasResponseRequiredAsksForHandle('@you')).toBe(true);
  });

  it('rejects self-merge', async () => {
    const { source } = setupTwoAsksForJames();
    const response = await runHandler(eventFor(source.id, {
      intoAskId: source.id, mergedByHandle: '@you'
    }));
    expect(response.status).toBe(400);
  });

  it('rejects merging an already-resolved source', async () => {
    const { source, into } = setupTwoAsksForJames();
    answerAsk({ askId: source.id, answeredByHandle: '@you', answer: 'fine' });
    const response = await runHandler(eventFor(source.id, {
      intoAskId: into.id, mergedByHandle: '@you'
    }));
    expect(response.status).toBe(400);
  });

  it('rejects merging into a different targetHandle', async () => {
    resetChatRoomStoreForTests();
    resetAskStoreForTests();
    const room = createChatRoom({ name: 'cross-target', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr' });
    // Two human-targeted asks at DIFFERENT humans → can't merge.
    const a = openAskInRoom({
      roomId: room.id, openedByHandle: '@askr', targetHandle: '@you',
      title: 'q a', body: 'b'
    });
    // @mark isn't a member, so we have to set targetHandle to a real human;
    // simulate cross-target by using NULL on one side.
    const b = openAskInRoom({
      roomId: room.id, openedByHandle: '@askr',
      title: 'q b', body: 'b'  // no targetHandle → NULL
    });
    const response = await runHandler(eventFor(a.id, {
      intoAskId: b.id, mergedByHandle: '@you'
    }));
    expect(response.status).toBe(400);
    expect(findAskById(a.id)?.status).toBe('open');
  });

  it('404 on unknown source ask', async () => {
    resetAskStoreForTests();
    const response = await runHandler(eventFor('ask_unknown', {
      intoAskId: 'ask_also_unknown', mergedByHandle: '@you'
    }));
    expect(response.status).toBe(404);
  });

  it('404 on unknown into ask', async () => {
    const { source } = setupTwoAsksForJames();
    const response = await runHandler(eventFor(source.id, {
      intoAskId: 'ask_unknown', mergedByHandle: '@you'
    }));
    expect(response.status).toBe(404);
  });

  it('400 on missing intoAskId / missing mergedByHandle / malformed body', async () => {
    const { source, into } = setupTwoAsksForJames();
    expect((await runHandler(eventFor(source.id, { mergedByHandle: '@you' }))).status).toBe(400);
    expect((await runHandler(eventFor(source.id, { intoAskId: into.id }))).status).toBe(400);
    // Malformed JSON
    const malformed = eventFor(source.id, {});
    (malformed as { request: Request }).request = new Request(
      'http://localhost/api/asks/x/merge',
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_ADMIN_TOKEN}` }, body: '{ broken' }
    );
    expect((await runHandler(malformed)).status).toBe(400);
  });
});
