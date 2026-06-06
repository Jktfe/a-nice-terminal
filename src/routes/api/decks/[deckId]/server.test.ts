import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { canonicaliseOperatorHandle } from '$lib/server/operatorHandle';

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(deckId: string, search = '', cookie = '') {
  const url = new URL(`http://localhost/api/decks/${deckId}${search}`);
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const request = new Request(url.toString(), { headers });
  return { request, params: { deckId }, url } as unknown as AnyEvent;
}

async function runHandler(handler: (event: AnyEvent) => unknown, event: AnyEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

async function memberCookie(roomId: string, handle = '@you'): Promise<string> {
  const db = (await import('$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const storageHandle = canonicaliseOperatorHandle(handle);
  const termId = `t_${storageHandle.slice(1)}_${roomId.slice(0, 8)}`;
  const memId = `mem_${storageHandle.slice(1)}_${roomId.slice(0, 8)}`;
  const bsId = `bs_${storageHandle.slice(1)}_${roomId.slice(0, 8)}`;
  db.prepare(`INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at) VALUES (?, 0, 'test', ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`)
    .run(termId, `test-term-${termId}`, nowSec + 99999, nowSec, nowSec);
  db.prepare(`INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(memId, roomId, storageHandle, termId, nowSec);
  const result = createBrowserSession({ roomId, authorHandle: handle, browserSessionId: bsId });
  if (!result) throw new Error('Failed to create browser session');
  return result.browserSessionSecret;
}

describe('/api/decks/:deckId', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetDeckStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('GET 404s for missing deck', async () => {
    const response = await runHandler(GET, eventFor('ghost'));
    expect(response.status).toBe(404);
  });

  it('GET 403s for non-member without password', async () => {
    const room = createChatRoom({ name: 'test-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Secret', accessPassword: 'hunter2' });
    const response = await runHandler(GET, eventFor(deck.id));
    expect(response.status).toBe(403);
  });

  it('GET 200s with correct password', async () => {
    const room = createChatRoom({ name: 'test-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Secret', accessPassword: 'hunter2' });
    const response = await runHandler(GET, eventFor(deck.id, '?password=hunter2'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deck.title).toBe('Secret');
    expect(body.deck.accessPassword).toBeUndefined();
  });

  it('GET 200s for room member via browser session cookie', async () => {
    const room = createChatRoom({ name: 'member-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Member Only' });
    const cookie = await memberCookie(room.id, '@you');
    const response = await runHandler(GET, eventFor(deck.id, '', `ant_browser_session=${cookie}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deck.title).toBe('Member Only');
    expect(body.deck.accessPassword).toBeUndefined();
  });

  it('GET 403s with wrong password (fail-fast)', async () => {
    const room = createChatRoom({ name: 'test-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Secret', accessPassword: 'hunter2' });
    const response = await runHandler(GET, eventFor(deck.id, '?password=wrong'));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toContain('Incorrect deck password');
  });

  it('GET 200s for a cross-room session when the resolved handle is a deck-room member', async () => {
    const roomA = createChatRoom({ name: 'room-a', whoCreatedIt: '@owner' });
    const roomB = createChatRoom({ name: 'room-b', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: roomA.id, title: 'Room A Deck' });
    const cookie = await memberCookie(roomB.id, '@you');
    const response = await runHandler(GET, eventFor(deck.id, '', `ant_browser_session=${cookie}`));
    expect(response.status).toBe(200);
  });

  it('GET 200s for member with password-less deck', async () => {
    const room = createChatRoom({ name: 'open-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Open Deck', accessPassword: null });
    const cookie = await memberCookie(room.id, '@you');
    const response = await runHandler(GET, eventFor(deck.id, '', `ant_browser_session=${cookie}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deck.title).toBe('Open Deck');
  });
});
