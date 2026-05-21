import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createInvite,
  exchangePasswordForToken,
  resetChatInviteStoreForTests,
  revokeInvite,
  revokeToken
} from '$lib/server/chatInviteStore';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';

type HandlerEvent = Parameters<typeof POST>[0];

const PASSWORD = 'correct-horse-battery-staple';

beforeEach(() => {
  resetChatInviteStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatInviteStoreForTests();
  resetChatRoomStoreForTests();
});

function makePostEvent(roomId: string, bodyValue: unknown): HandlerEvent {
  const bodyText = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  return {
    params: { roomId },
    request: new Request(`http://test.local/api/chat-rooms/${roomId}/join-with-token`, {
      method: 'POST',
      body: bodyText
    })
  } as unknown as HandlerEvent;
}

function seed(handleOnExchange: string | null = '@guest') {
  const room = createChatRoom({ name: 'Test', whoCreatedIt: '@claude2' });
  const invite = createInvite({
    roomId: room.id,
    label: 'Team',
    password: PASSWORD,
    kinds: ['cli'],
    createdBy: '@claude2'
  });
  const exchange = exchangePasswordForToken({
    inviteId: invite.id,
    password: PASSWORD,
    kind: 'cli',
    handle: handleOnExchange
  });
  return { room, invite, exchange };
}

async function expectStatus(promise: unknown, expected: number) {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

describe('chat-rooms join-with-token endpoint', () => {
  it('J1: 200 success returns room+member+identity with normalised handle', async () => {
    const { room, exchange } = seed('@guest');
    const response = await POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { room: { members: { handle: string }[] }; member: { handle: string }; identity: { tokenId: string } };
    expect(body.member.handle).toBe('@guest');
    expect(body.identity.tokenId).toBe(exchange.tokenId);
    expect(body.room.members.some((m) => m.handle === '@guest')).toBe(true);
  });

  it('J2: 401 generic on bogus tokenSecret', async () => {
    const { room } = seed('@guest');
    await expectStatus(POST(makePostEvent(room.id, { tokenSecret: 'not-a-real-token' })), 401);
  });

  it('J3: 401 generic on right token + wrong roomId', async () => {
    const { exchange } = seed('@guest');
    const otherRoom = createChatRoom({ name: 'Other', whoCreatedIt: '@claude2' });
    await expectStatus(POST(makePostEvent(otherRoom.id, { tokenSecret: exchange.tokenSecret })), 401);
  });

  it('J4: 401 after revokeInvite', async () => {
    const { room, invite, exchange } = seed('@guest');
    revokeInvite(invite.id);
    await expectStatus(POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret })), 401);
  });

  it('J5: 401 after revokeToken', async () => {
    const { room, exchange } = seed('@guest');
    revokeToken(exchange.tokenId);
    await expectStatus(POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret })), 401);
  });

  it('J6: 400 on missing tokenSecret / malformed body / empty / array / null', async () => {
    const { room } = seed('@guest');
    await expectStatus(POST(makePostEvent(room.id, {})), 400);
    await expectStatus(POST(makePostEvent(room.id, 'not-json{')), 400);
    await expectStatus(POST(makePostEvent(room.id, '')), 400);
    await expectStatus(POST(makePostEvent(room.id, [])), 400);
    await expectStatus(POST(makePostEvent(room.id, null)), 400);
  });

  it('J7: 400 on token-with-no-handle (admin-must-mint-with-handle invariant)', async () => {
    const { room, exchange } = seed(null);
    await expectStatus(POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret })), 400);
  });

  it('J8: idempotent — second POST returns 200, room.members has no duplicate', async () => {
    const { room, exchange } = seed('@guest');
    const first = await POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret }));
    expect(first.status).toBe(200);
    const second = await POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret }));
    expect(second.status).toBe(200);
    const body = (await second.json()) as { room: { members: { handle: string }[] } };
    const guests = body.room.members.filter((m) => m.handle === '@guest');
    expect(guests.length).toBe(1);
  });

  it('J9: 401 when room id refers to nonexistent room (verifyToken filters first)', async () => {
    const { exchange } = seed('@guest');
    await expectStatus(POST(makePostEvent('room-that-does-not-exist', { tokenSecret: exchange.tokenSecret })), 401);
  });

  it('J10 REGRESSION: tokenSecret never appears in success response body', async () => {
    const { room, exchange } = seed('@guest');
    const response = await POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret }));
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText.includes(exchange.tokenSecret)).toBe(false);
    expect(bodyText.includes('password_hash')).toBe(false);
    expect(bodyText.includes('token_hash')).toBe(false);
    expect(bodyText.includes('failed_attempts')).toBe(false);
  });

  it('J11 REGRESSION: handle-missing returns fixed "token has no handle" message, not raw thrown error', async () => {
    const { room, exchange } = seed(null);
    let captured: unknown = null;
    try {
      await POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret }));
    } catch (failure) {
      captured = failure;
    }
    expect((captured as { status?: number }).status).toBe(400);
    const message = (captured as { body?: { message?: string } }).body?.message ?? '';
    expect(message).toBe('token has no handle');
    expect(message.includes('admin must mint')).toBe(false);
  });

  it('J12 REGRESSION (failure path): tokenSecret never appears in 401 error body', async () => {
    const { room, exchange } = seed('@guest');
    let captured: unknown = null;
    try {
      await POST(makePostEvent('room-that-does-not-exist', { tokenSecret: exchange.tokenSecret }));
    } catch (failure) {
      captured = failure;
    }
    expect((captured as { status?: number }).status).toBe(401);
    const errorBodyText = JSON.stringify((captured as { body?: unknown }).body ?? {});
    expect(errorBodyText.includes(exchange.tokenSecret)).toBe(false);
    expect(errorBodyText.includes('password_hash')).toBe(false);
    expect(errorBodyText.includes('token_hash')).toBe(false);
    expect(errorBodyText.includes('failed_attempts')).toBe(false);
    // also unused but unrelated check
    void room;
  });

  it('J13 REGRESSION (failure path): tokenSecret never appears in 400 no-handle body', async () => {
    const { room, exchange } = seed(null);
    let captured: unknown = null;
    try {
      await POST(makePostEvent(room.id, { tokenSecret: exchange.tokenSecret }));
    } catch (failure) {
      captured = failure;
    }
    expect((captured as { status?: number }).status).toBe(400);
    const errorBodyText = JSON.stringify((captured as { body?: unknown }).body ?? {});
    expect(errorBodyText.includes(exchange.tokenSecret)).toBe(false);
  });
});
