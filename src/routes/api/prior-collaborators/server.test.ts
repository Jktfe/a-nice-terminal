import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  recordParticipation,
  resetChatRoomParticipationHistoryStoreForTests
} from '$lib/server/chatRoomParticipationHistoryStore';

function eventFor(query: string) {
  const url = new URL(`http://localhost/api/prior-collaborators${query}`);
  const request = new Request(url.toString(), { method: 'GET' });
  return { request, params: {}, url } as unknown as Parameters<typeof GET>[0];
}

async function runHandler(event: Parameters<typeof GET>[0]): Promise<Response> {
  try {
    return (await GET(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('GET /api/prior-collaborators', () => {
  beforeEach(() => {
    resetChatRoomParticipationHistoryStoreForTests();
  });

  it('returns 200 with sorted handles seen in other rooms', async () => {
    recordParticipation({ globalHandle: '@codex', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@claude', roomId: 'roomA' });

    const response = await runHandler(eventFor('?excludeRoomId=roomB'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { handles: string[] };
    expect(body.handles).toEqual(['@claude', '@codex']);
  });

  it('omits handles whose only room is the excluded room', async () => {
    recordParticipation({ globalHandle: '@onlyA', roomId: 'roomA' });

    const response = await runHandler(eventFor('?excludeRoomId=roomA'));
    const body = (await response.json()) as { handles: string[] };
    expect(body.handles).toEqual([]);
  });

  it('returns 400 when excludeRoomId is missing', async () => {
    const response = await runHandler(eventFor(''));
    expect(response.status).toBe(400);
  });

  it('returns 400 when excludeRoomId is whitespace-only after trim', async () => {
    const response = await runHandler(eventFor('?excludeRoomId=' + encodeURIComponent('   ')));
    expect(response.status).toBe(400);
  });

  it('honours partialMatch as a case-insensitive substring filter', async () => {
    recordParticipation({ globalHandle: '@evolveantclaude', roomId: 'roomA' });
    recordParticipation({ globalHandle: '@codex', roomId: 'roomA' });

    const response = await runHandler(eventFor('?excludeRoomId=roomB&partialMatch=CLAUDE'));
    const body = (await response.json()) as { handles: string[] };
    expect(body.handles).toEqual(['@evolveantclaude']);
  });

  it('returns an empty list when nothing has been recorded yet', async () => {
    const response = await runHandler(eventFor('?excludeRoomId=roomB'));
    const body = (await response.json()) as { handles: string[] };
    expect(body.handles).toEqual([]);
  });
});
