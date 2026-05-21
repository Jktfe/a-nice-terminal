import { beforeEach, describe, expect, it } from 'vitest';
import {
  ensureBrowserSessionForRoom,
  resetBrowserSessionClientForTests
} from './browserSessionClient';

type FetchCall = { input: string; init?: RequestInit };

function okFetch(calls: FetchCall[]) {
  return async (input: string, init?: RequestInit) => {
    calls.push({ input, init });
    return { ok: true };
  };
}

describe('ensureBrowserSessionForRoom', () => {
  beforeEach(() => {
    resetBrowserSessionClientForTests();
  });

  it('POSTs the room browser-session endpoint with the authorHandle body', async () => {
    const calls: FetchCall[] = [];
    const result = await ensureBrowserSessionForRoom({
      roomId: 'room_1',
      authorHandle: '@you',
      fetcher: okFetch(calls)
    });

    // b185190: ensureBrowserSessionForRoom returns a result object
    // `{ ok, reason?, status? }` instead of a bare boolean — operators
    // need the failure reason for the sessionMintError surface.
    expect(result).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('/api/chat-rooms/room_1/browser-session');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ authorHandle: '@you' });
  });

  it('caches successful establishment per room and handle', async () => {
    const calls: FetchCall[] = [];
    const fetcher = okFetch(calls);

    await ensureBrowserSessionForRoom({ roomId: 'room_1', authorHandle: '@you', fetcher });
    await ensureBrowserSessionForRoom({ roomId: 'room_1', authorHandle: '@you', fetcher });

    expect(calls).toHaveLength(1);
  });

  it('does not cache failed attempts so the next call can retry', async () => {
    const calls: FetchCall[] = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return { ok: false };
    };

    await expect(
      ensureBrowserSessionForRoom({ roomId: 'room_1', authorHandle: '@you', fetcher })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      ensureBrowserSessionForRoom({ roomId: 'room_1', authorHandle: '@you', fetcher })
    ).resolves.toMatchObject({ ok: false });

    expect(calls).toHaveLength(2);
  });

  it('keeps room and handle cache keys separate', async () => {
    const calls: FetchCall[] = [];
    const fetcher = okFetch(calls);

    await ensureBrowserSessionForRoom({ roomId: 'room_1', authorHandle: '@you', fetcher });
    await ensureBrowserSessionForRoom({ roomId: 'room_1', authorHandle: '@other', fetcher });
    await ensureBrowserSessionForRoom({ roomId: 'room_2', authorHandle: '@you', fetcher });

    expect(calls.map((call) => [call.input, JSON.parse(String(call.init?.body)).authorHandle])).toEqual([
      ['/api/chat-rooms/room_1/browser-session', '@you'],
      ['/api/chat-rooms/room_1/browser-session', '@other'],
      ['/api/chat-rooms/room_2/browser-session', '@you']
    ]);
  });
});
