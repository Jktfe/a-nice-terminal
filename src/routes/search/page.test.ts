import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';

type LoadEvent = Parameters<typeof load>[0];
type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const SEARCH_ADMIN_TOKEN = 'search-page-test-admin';

function buildLoadEvent(rawUrl: string, fetchImpl: typeof fetch): LoadEvent {
  return {
    url: new URL(`http://localhost${rawUrl}`),
    fetch: fetchImpl,
    params: {},
    route: { id: '/search' },
    parent: async () => ({}),
    depends: () => {},
    untrack: <T>(fn: () => T) => fn(),
    setHeaders: () => {}
  } as unknown as LoadEvent;
}

async function runLoad(event: LoadEvent): Promise<LoadResult> {
  const result = await load(event);
  if (!result) throw new Error('load() returned void; expected a data object.');
  return result as LoadResult;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/search +page.ts load', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = SEARCH_ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it('returns an empty state when no ?q= is provided', async () => {
    const mockFetch = vi.fn();
    const result = await runLoad(buildLoadEvent('/search', mockFetch));
    expect(result.queryFromServer).toBe('');
    expect(result.hitsFromServer).toEqual([]);
    expect(result.searchFetchFailed).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns an empty state when ?q= is whitespace-only', async () => {
    const mockFetch = vi.fn();
    const result = await runLoad(buildLoadEvent('/search?q=%20%20', mockFetch));
    expect(result.queryFromServer).toBe('');
    expect(result.hitsFromServer).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards a trimmed query into the search endpoint and returns the hits', async () => {
    const fakeHits = [
      {
        roomId: 'r1',
        roomName: 'Room One',
        message: {
          id: 'm1',
          roomId: 'r1',
          authorHandle: '@you',
          authorDisplayName: 'You',
          kind: 'human',
          body: 'hello world',
          postedAt: '2026-05-12T10:00:00.000Z',
          postOrder: 1
        }
      }
    ];
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ hits: fakeHits }));

    const result = await runLoad(buildLoadEvent('/search?q=%20hello%20', mockFetch));

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/search-messages?query=hello');
    expect(calledUrl).toContain('limit=50');
    expect(result.queryFromServer).toBe('hello');
    expect(result.hitsFromServer).toEqual(fakeHits);
    expect(result.searchFetchFailed).toBe(false);
  });

  it('forwards allContent when the user explicitly asks for full-room search', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ hits: [] }));

    await runLoad(buildLoadEvent('/search?q=hello&roomId=r1&allContent=1', mockFetch));

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('roomId=r1');
    expect(calledUrl).toContain('allContent=1');
  });

  it('flags searchFetchFailed when the api returns a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 })
    );
    const result = await runLoad(buildLoadEvent('/search?q=anything', mockFetch));
    expect(result.queryFromServer).toBe('anything');
    expect(result.hitsFromServer).toEqual([]);
    expect(result.searchFetchFailed).toBe(true);
  });

  it('round-trips through the real /api/search-messages endpoint', async () => {
    const room = createChatRoom({ name: 'live-room', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'find me' });

    const realStyleFetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const { GET } = await import('../api/search-messages/+server');
      const fullUrl = new URL(`http://localhost${url}`);
      const event = {
        request: new Request(fullUrl, {
          headers: { authorization: `Bearer ${SEARCH_ADMIN_TOKEN}` }
        }),
        params: {},
        url: fullUrl
      } as unknown as Parameters<typeof GET>[0];
      return (await GET(event)) as Response;
    }) as unknown as typeof fetch;

    const result = await runLoad(buildLoadEvent('/search?q=find', realStyleFetch));
    expect(result.hitsFromServer).toHaveLength(1);
    expect(result.hitsFromServer[0].message.body).toBe('find me');
    expect(result.hitsFromServer[0].roomName).toBe('live-room');
  });
});
