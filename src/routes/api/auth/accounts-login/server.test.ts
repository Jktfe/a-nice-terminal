import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';

const PREV_OPERATOR_EMAIL = process.env.ANT_OPERATOR_EMAIL;
const PREV_OPERATOR_HANDLE = process.env.ANT_OPERATOR_HANDLE;
const PREV_BROWSER_LOGIN_ROOM_ID = process.env.ANT_BROWSER_LOGIN_ROOM_ID;

function resetIdentityRows(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM browser_sessions').run();
  db.prepare('DELETE FROM room_memberships').run();
  db.prepare('DELETE FROM terminals').run();
  resetChatRoomStoreForTests();
}

function eventForPost(body: unknown) {
  return {
    request: new Request('https://mac.kingfisher-interval.ts.net/api/auth/accounts-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    url: new URL('https://mac.kingfisher-interval.ts.net/api/auth/accounts-login'),
    params: {}
  } as never;
}

async function capture(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  resetIdentityRows();
  const room = createChatRoom({ name: 'operator landing', whoCreatedIt: '@JWPK' });
  process.env.ANT_BROWSER_LOGIN_ROOM_ID = room.id;
  process.env.ANT_OPERATOR_EMAIL = 'james@newmodel.vc';
  process.env.ANT_OPERATOR_HANDLE = '@JWPK';
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetIdentityRows();
  if (PREV_OPERATOR_EMAIL === undefined) delete process.env.ANT_OPERATOR_EMAIL;
  else process.env.ANT_OPERATOR_EMAIL = PREV_OPERATOR_EMAIL;
  if (PREV_OPERATOR_HANDLE === undefined) delete process.env.ANT_OPERATOR_HANDLE;
  else process.env.ANT_OPERATOR_HANDLE = PREV_OPERATOR_HANDLE;
  if (PREV_BROWSER_LOGIN_ROOM_ID === undefined) delete process.env.ANT_BROWSER_LOGIN_ROOM_ID;
  else process.env.ANT_BROWSER_LOGIN_ROOM_ID = PREV_BROWSER_LOGIN_ROOM_ID;
});

describe('POST /api/auth/accounts-login', () => {
  it('sends an Origin header to Better Auth sign-in', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/sign-in/email')) {
        return Response.json({
          token: 'better-auth-token',
          user: { email: 'james@newmodel.vc' }
        });
      }
      if (url.endsWith('/api/auth/me')) {
        return Response.json({
          user: { email: 'james@newmodel.vc', handle: '@JWPK' },
          expiresAt: Date.now() + 60_000
        });
      }
      return Response.json({ message: 'unexpected upstream' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'james@newmodel.vc', password: 'correct-password' }))
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      origin: 'https://accounts.antonline.dev'
    });
  });
});
