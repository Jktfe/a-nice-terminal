import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { archiveChatRoom, createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';
import { getPersistedOperatorEmail, setOperatorEmail } from '$lib/server/operatorEmail';

const PREV_OPERATOR_EMAIL = process.env.ANT_OPERATOR_EMAIL;
const PREV_DEMO_EMAIL = process.env.ANT_DEMO_EMAIL;
const PREV_OPERATOR_HANDLE = process.env.ANT_OPERATOR_HANDLE;
const PREV_BROWSER_LOGIN_ROOM_ID = process.env.ANT_BROWSER_LOGIN_ROOM_ID;
let activeRoomId: string;

function resetIdentityRows(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM server_config WHERE key = 'operator_email'`).run();
  db.prepare('DELETE FROM browser_sessions').run();
  db.prepare('DELETE FROM room_memberships').run();
  db.prepare('DELETE FROM terminals').run();
  resetChatRoomStoreForTests();
}

function eventForPost(body: unknown) {
  return {
    request: new Request('https://mac.example.ts.net/api/auth/accounts-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    url: new URL('https://mac.example.ts.net/api/auth/accounts-login'),
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
  activeRoomId = room.id;
  process.env.ANT_BROWSER_LOGIN_ROOM_ID = room.id;
  process.env.ANT_OPERATOR_EMAIL = 'operator@example.com';
  delete process.env.ANT_DEMO_EMAIL;
  process.env.ANT_OPERATOR_HANDLE = '@JWPK';
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetIdentityRows();
  if (PREV_OPERATOR_EMAIL === undefined) delete process.env.ANT_OPERATOR_EMAIL;
  else process.env.ANT_OPERATOR_EMAIL = PREV_OPERATOR_EMAIL;
  if (PREV_DEMO_EMAIL === undefined) delete process.env.ANT_DEMO_EMAIL;
  else process.env.ANT_DEMO_EMAIL = PREV_DEMO_EMAIL;
  if (PREV_OPERATOR_HANDLE === undefined) delete process.env.ANT_OPERATOR_HANDLE;
  else process.env.ANT_OPERATOR_HANDLE = PREV_OPERATOR_HANDLE;
  if (PREV_BROWSER_LOGIN_ROOM_ID === undefined) delete process.env.ANT_BROWSER_LOGIN_ROOM_ID;
  else process.env.ANT_BROWSER_LOGIN_ROOM_ID = PREV_BROWSER_LOGIN_ROOM_ID;
});

describe('POST /api/auth/accounts-login', () => {
  function stubAccountsIdentity(email: string) {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/sign-in/email')) {
        return Response.json({
          token: 'better-auth-token',
          user: { email }
        });
      }
      if (url.endsWith('/api/auth/me')) {
        return Response.json({
          user: { email, handle: '@JWPK' },
          expiresAt: Date.now() + 60_000
        });
      }
      return Response.json({ message: 'unexpected upstream' }, { status: 500 });
    });
  }

  it('sends an Origin header to Better Auth sign-in', async () => {
    const fetchMock = stubAccountsIdentity('operator@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'operator@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      origin: 'https://accounts.antonline.dev'
    });
  });

  it('fails closed instead of minting an operator browser session when no operator email is configured', async () => {
    delete process.env.ANT_OPERATOR_EMAIL;
    delete process.env.ANT_DEMO_EMAIL;
    const fetchMock = stubAccountsIdentity('operator@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'operator@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'operator_email_not_configured',
      fallbackToStoredLogin: false
    });
    expect(getPersistedOperatorEmail()).toBeNull();
  });

  it('accepts a persisted operator email when env is unset', async () => {
    delete process.env.ANT_OPERATOR_EMAIL;
    delete process.env.ANT_DEMO_EMAIL;
    setOperatorEmail({ email: 'operator@example.com', updatedBy: 'owners-register' });
    const fetchMock = stubAccountsIdentity('operator@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'operator@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(200);
  });

  it('falls back to an active room when the configured landing room is archived', async () => {
    const archived = createChatRoom({ name: 'archived operator landing', whoCreatedIt: '@JWPK' });
    archiveChatRoom(archived.id);
    process.env.ANT_BROWSER_LOGIN_ROOM_ID = archived.id;
    const fetchMock = stubAccountsIdentity('operator@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'operator@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.roomId).toBe(activeRoomId);
  });

  it('rejects a different account after operator email is established', async () => {
    delete process.env.ANT_OPERATOR_EMAIL;
    delete process.env.ANT_DEMO_EMAIL;
    setOperatorEmail({ email: 'operator@example.com', updatedBy: 'owners-register' });
    const fetchMock = stubAccountsIdentity('other@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'other@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'account_not_configured_operator',
      fallbackToStoredLogin: false
    });
    expect(getPersistedOperatorEmail()).toBe('operator@example.com');
  });

  it('does not ask the browser page to fall back when local browser session room lookup fails', async () => {
    process.env.ANT_BROWSER_LOGIN_ROOM_ID = 'missing-room';
    resetChatRoomStoreForTests();
    const fetchMock = stubAccountsIdentity('operator@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'operator@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'browser_login_room_unavailable',
      fallbackToStoredLogin: false,
      message: expect.stringContaining('account signed in')
    });
    expect(getPersistedOperatorEmail()).toBeNull();
  });

  it('stores an env-confirmed operator email during successful account confirmation', async () => {
    const fetchMock = stubAccountsIdentity('operator@example.com');
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() =>
      POST(eventForPost({ email: 'operator@example.com', password: 'correct-password' }))
    );

    expect(response.status).toBe(200);
    expect(getPersistedOperatorEmail()).toBe('operator@example.com');
  });
});
