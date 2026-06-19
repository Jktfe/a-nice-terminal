/**
 * Endpoint tests for /api/deck-settings — operator-owned file-layer editor
 * for ~/.ant/deck-settings.json.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GET, PUT } from './+server';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${process.env.ANT_ADMIN_TOKEN ?? 'test-admin'}`);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function operatorCookie(): string {
  const room = createChatRoom({ name: 'deck-settings-operator', whoCreatedIt: '@JWPK' });
  const terminal = upsertTerminal({
    pid: Math.floor(Math.random() * 10_000) + 1,
    pid_start: 'deck-settings-operator-session',
    name: 'deck-settings-operator-session'
  });
  addMembership({ room_id: room.id, handle: '@JWPK', terminal_id: terminal.id });
  const session = createBrowserSession({ roomId: room.id, authorHandle: '@JWPK' });
  if (!session) throw new Error('createBrowserSession returned null');
  return `ant_browser_session=${session.browserSessionSecret}`;
}

function getEvent(request = adminRequest('/api/deck-settings')) {
  return { request } as unknown as Parameters<typeof GET>[0];
}

function putEvent(body: unknown, requestInit: RequestInit = {}) {
  const request = adminRequest('/api/deck-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(requestInit.headers ?? {}) },
    body: JSON.stringify(body)
  });
  return { request } as unknown as Parameters<typeof PUT>[0];
}

function operatorPutEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/deck-settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: operatorCookie()
      },
      body: JSON.stringify(body)
    })
  } as unknown as Parameters<typeof PUT>[0];
}

async function callOrCaught<T extends (event: any) => any>(
  fn: T,
  event: Parameters<T>[0]
): Promise<Response> {
  try {
    return (await fn(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

let scratchDir: string;
let deckDir: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalAdminToken: string | undefined;
let originalDbPath: string | undefined;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-deck-settings-route-'));
  deckDir = join(scratchDir, 'decks');
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalAdminToken = process.env.ANT_ADMIN_TOKEN;
  originalDbPath = process.env.ANT_FRESH_DB_PATH;
  process.env.HOME = scratchDir;
  process.env.USERPROFILE = scratchDir;
  process.env.ANT_ADMIN_TOKEN = 'test-admin';
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = originalAdminToken;
  if (originalDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = originalDbPath;
});

describe('GET /api/deck-settings', () => {
  it('rejects without admin bearer or operator session', async () => {
    const res = await callOrCaught(GET, getEvent(new Request('http://localhost/api/deck-settings')));
    expect(res.status).toBe(401);
  });

  it('returns settings for an admin caller', async () => {
    const res = await callOrCaught(GET, getEvent());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { envRoots: string[]; fileRoots: string[]; resolved: string[] };
    expect(Array.isArray(body.envRoots)).toBe(true);
    expect(Array.isArray(body.fileRoots)).toBe(true);
    expect(Array.isArray(body.resolved)).toBe(true);
  });

  it('returns settings for the operator browser session', async () => {
    const request = new Request('http://localhost/api/deck-settings', {
      headers: { cookie: operatorCookie() }
    });
    const res = await callOrCaught(GET, getEvent(request));
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/deck-settings', () => {
  it('rejects without admin bearer or operator session', async () => {
    const request = new Request('http://localhost/api/deck-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decksRoots: [] })
    });
    const res = await callOrCaught(PUT, { request } as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(401);
  });

  it('writes valid input as admin', async () => {
    const res = await callOrCaught(PUT, putEvent({ decksRoots: [deckDir, '  '] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileRoots: string[] };
    expect(body.fileRoots).toEqual([deckDir]);
  });

  it('writes valid input as the operator browser session', async () => {
    const res = await callOrCaught(PUT, operatorPutEvent({ decksRoots: [deckDir] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileRoots: string[] };
    expect(body.fileRoots).toEqual([deckDir]);
  });
});
