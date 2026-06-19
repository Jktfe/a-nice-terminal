import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT } from './+server';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import {
  getRoomMemberPreferences,
  resetRoomMemberPreferencesStoreForTests
} from '$lib/server/roomMemberPreferencesStore';

type PreferencesEvent = Parameters<typeof PUT>[0];

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-prefs-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'fresh.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetRoomMemberPreferencesStoreForTests();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDb;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetRoomMemberPreferencesStoreForTests();
});

function eventFor(
  method: 'GET' | 'PUT',
  roomId: string,
  opts: { cookie?: string; body?: unknown } = {}
): PreferencesEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${encodeURIComponent(roomId)}/preferences`);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return { request: new Request(url, init), params: { roomId }, url } as PreferencesEvent;
}

async function run(handler: (event: PreferencesEvent) => unknown, event: PreferencesEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

function seedBrowserSession(roomId: string, handle: string): string {
  const db = getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const terminalId = `t_prefs_${handle.replace(/[^a-zA-Z0-9]/g, '')}`;
  db.prepare(
    `INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, 0, 'test', ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(terminalId, `term-${handle}`, nowSec + 99_999, nowSec, nowSec);
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem-${terminalId}-${roomId}`, roomId, handle, terminalId, nowSec);
  const session = createBrowserSession({ roomId, authorHandle: handle, browserSessionId: `bs_${terminalId}_${roomId}` });
  if (!session) throw new Error('Failed to create browser session');
  return `ant_browser_session=${session.browserSessionSecret}`;
}

describe('/api/chat-rooms/:roomId/preferences', () => {
  it('GET requires room read access', async () => {
    const room = createChatRoom({ name: 'prefs-private', whoCreatedIt: '@viewer' });

    const response = await run(GET, eventFor('GET', room.id));

    expect(response.status).toBe(401);
  });

  it('GET returns default false flags for the signed-in viewer', async () => {
    const room = createChatRoom({ name: 'prefs-defaults', whoCreatedIt: '@viewer' });
    const cookie = seedBrowserSession(room.id, '@viewer');

    const response = await run(GET, eventFor('GET', room.id, { cookie }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      roomId: room.id,
      handle: '@viewer',
      pinned: false,
      muted: false,
      archived: false,
      updatedAtMs: 0
    });
  });

  it('PUT stores only the signed-in viewer preferences and GET reads them back', async () => {
    const room = createChatRoom({ name: 'prefs-write', whoCreatedIt: '@viewer' });
    const cookie = seedBrowserSession(room.id, '@viewer');

    const written = await run(PUT, eventFor('PUT', room.id, {
      cookie,
      body: { pinned: true, muted: true }
    }));
    expect(written.status).toBe(200);

    const read = await run(GET, eventFor('GET', room.id, { cookie }));
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      roomId: room.id,
      handle: '@viewer',
      pinned: true,
      muted: true,
      archived: false
    });
  });

  it('PUT without read access returns 401 and writes nothing', async () => {
    const room = createChatRoom({ name: 'prefs-write-denied', whoCreatedIt: '@viewer' });

    const response = await run(PUT, eventFor('PUT', room.id, {
      body: { pinned: true }
    }));

    expect(response.status).toBe(401);
    expect(getRoomMemberPreferences(room.id, '@viewer').pinned).toBe(false);
  });

  it('keeps preferences independent per viewer in the same room', async () => {
    const room = createChatRoom({ name: 'prefs-viewers', whoCreatedIt: '@alice' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bob' });
    const aliceCookie = seedBrowserSession(room.id, '@alice');
    const bobCookie = seedBrowserSession(room.id, '@bob');

    await run(PUT, eventFor('PUT', room.id, {
      cookie: aliceCookie,
      body: { pinned: true }
    }));
    await run(PUT, eventFor('PUT', room.id, {
      cookie: bobCookie,
      body: { muted: true }
    }));

    const alice = await run(GET, eventFor('GET', room.id, { cookie: aliceCookie }));
    const bob = await run(GET, eventFor('GET', room.id, { cookie: bobCookie }));

    await expect(alice.json()).resolves.toMatchObject({ handle: '@alice', pinned: true, muted: false });
    await expect(bob.json()).resolves.toMatchObject({ handle: '@bob', pinned: false, muted: true });
  });
});
