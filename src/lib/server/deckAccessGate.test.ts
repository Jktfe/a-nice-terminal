import { describe, expect, it, beforeEach } from 'vitest';
import { resolveDeckAccess } from './deckAccessGate';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { createDeck, resetDeckStoreForTests } from './deckStore';
import { createBrowserSession } from './browserSessionStore';
import { addMembership } from './roomMembershipsStore';
import { upsertTerminal } from './terminalsStore';

describe('resolveDeckAccess', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetDeckStoreForTests();
  });

  it('allows access with correct password', () => {
    const room = createChatRoom({ name: 'secret-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Secret', accessPassword: 'hunter2' });
    const request = new Request('http://localhost/api/decks/' + deck.id + '?password=hunter2');
    const result = resolveDeckAccess({
      deckRoomId: room.id,
      deckAccessPassword: deck.accessPassword,
      request,
      url: new URL(request.url)
    });
    expect(result.allowed).toBe(true);
  });

  it('denies access with wrong password', () => {
    const room = createChatRoom({ name: 'secret-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Secret', accessPassword: 'hunter2' });
    const request = new Request('http://localhost/api/decks/' + deck.id + '?password=wrong');
    const result = resolveDeckAccess({
      deckRoomId: room.id,
      deckAccessPassword: deck.accessPassword,
      request,
      url: new URL(request.url)
    });
    expect(result.allowed).toBe(false);
  });

  it('denies access with no password and no cookie', () => {
    const room = createChatRoom({ name: 'secret-room', whoCreatedIt: '@owner' });
    const deck = createDeck({ roomId: room.id, title: 'Secret' });
    const request = new Request('http://localhost/api/decks/' + deck.id);
    const result = resolveDeckAccess({
      deckRoomId: room.id,
      deckAccessPassword: deck.accessPassword,
      request,
      url: new URL(request.url)
    });
    expect(result.allowed).toBe(false);
  });

  it('allows access via browser session cookie for room member', () => {
    const room = createChatRoom({ name: 'member-room', whoCreatedIt: '@owner' });
    const terminal = upsertTerminal({ pid: 42, pid_start: 'test', name: 'test-terminal' });
    addMembership({ room_id: room.id, handle: '@owner', terminal_id: terminal.id });
    const deck = createDeck({ roomId: room.id, title: 'Member-only' });
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@owner' });
    if (!session) throw new Error('session creation failed');
    const request = new Request('http://localhost/api/decks/' + deck.id, {
      headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
    });
    const result = resolveDeckAccess({
      deckRoomId: room.id,
      deckAccessPassword: deck.accessPassword,
      request,
      url: new URL(request.url)
    });
    expect(result.allowed).toBe(true);
  });

  // JWPK 2026-05-17 in ANT artefacts room (msg_pde718rya2 → msg_u2cu5rt4u8):
  // browser sessions are minted per-room, so clicking a deck link whose
  // room differs from the cookie's room used to 403 even when the caller
  // was a member of the deck's room. The gate now resolves identity from
  // the cookie WITHOUT room match, then checks membership against the
  // deck's room separately. This test pins the canonical repro.
  it('allows access when the cookie is for a DIFFERENT room and the caller is a member of the deck room', () => {
    const roomA = createChatRoom({ name: 'cookie-source', whoCreatedIt: '@traveller' });
    const roomB = createChatRoom({ name: 'deck-home', whoCreatedIt: '@hostess' });
    const terminal = upsertTerminal({ pid: 99, pid_start: 'crossroom', name: 'crossroom-terminal' });
    // Caller is a member of BOTH rooms. addMembership() seeds the
    // identity-layer room_memberships table (required by createBrowserSession);
    // inviteAgentToRoom() seeds the chat-layer chat_room_members table
    // (read by the deck access gate). The cookie was minted in room A.
    addMembership({ room_id: roomA.id, handle: '@traveller', terminal_id: terminal.id });
    addMembership({ room_id: roomB.id, handle: '@traveller', terminal_id: terminal.id });
    inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@traveller' });
    const deck = createDeck({ roomId: roomB.id, title: 'Lives-in-room-B' });
    const session = createBrowserSession({ roomId: roomA.id, authorHandle: '@traveller' });
    if (!session) throw new Error('session creation failed');
    const request = new Request('http://localhost/api/decks/' + deck.id, {
      headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
    });
    const result = resolveDeckAccess({
      deckRoomId: roomB.id,
      deckAccessPassword: deck.accessPassword,
      request,
      url: new URL(request.url)
    });
    expect(result.allowed).toBe(true);
  });

  it('still denies when the caller has a valid cookie but is NOT a member of the deck room', () => {
    const roomA = createChatRoom({ name: 'cookie-source-2', whoCreatedIt: '@stranger' });
    const roomB = createChatRoom({ name: 'private-deck-home', whoCreatedIt: '@hostess2' });
    const terminal = upsertTerminal({ pid: 101, pid_start: 'denial', name: 'denial-terminal' });
    addMembership({ room_id: roomA.id, handle: '@stranger', terminal_id: terminal.id });
    // Note: @stranger is NOT a member of roomB.
    const deck = createDeck({ roomId: roomB.id, title: 'Private-to-B' });
    const session = createBrowserSession({ roomId: roomA.id, authorHandle: '@stranger' });
    if (!session) throw new Error('session creation failed');
    const request = new Request('http://localhost/api/decks/' + deck.id, {
      headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` }
    });
    const result = resolveDeckAccess({
      deckRoomId: roomB.id,
      deckAccessPassword: deck.accessPassword,
      request,
      url: new URL(request.url)
    });
    expect(result.allowed).toBe(false);
  });
});
