import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createInvite, resetChatInviteStoreForTests } from '$lib/server/chatInviteStore';

type HandlerEvent = Parameters<typeof POST>[0];

beforeEach(() => {
  resetChatRoomStoreForTests();
  resetChatInviteStoreForTests();
});

afterEach(() => {
  resetChatInviteStoreForTests();
  resetChatRoomStoreForTests();
});

function makeEvent(roomId: string, inviteId: string, body: unknown): HandlerEvent {
  return {
    params: { roomId, inviteId },
    request: new Request(`http://test.local/api/sessions/${roomId}/invites/${inviteId}/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as unknown as HandlerEvent;
}

async function expectStatus(promise: unknown, expected: number) {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

describe('legacy antchat session invite exchange compatibility route', () => {
  it('returns the v1.1.1 token field names while minting a v4 chat invite token', async () => {
    const room = createChatRoom({ name: 'legacy exchange', whoCreatedIt: '@you' });
    const invite = createInvite({
      roomId: room.id,
      label: 'Legacy CLI',
      password: 'secret',
      kinds: ['cli'],
      createdBy: '@you'
    });

    const response = await POST(makeEvent(room.id, invite.id, {
      password: 'secret',
      kind: 'cli',
      handle: '@local-agent'
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      token_id: body.tokenId,
      invite_id: invite.id,
      inviteId: invite.id,
      room_id: room.id,
      roomId: room.id,
      kind: 'cli',
      handle: '@local-agent'
    });
    expect(body.token).toEqual(body.tokenSecret);
    expect(body.token).toMatch(/^[0-9a-f]+$/);
  });

  it('keeps exchange failures generic for stale clients', async () => {
    const room = createChatRoom({ name: 'legacy bad password', whoCreatedIt: '@you' });
    const invite = createInvite({
      roomId: room.id,
      label: 'Legacy CLI',
      password: 'secret',
      kinds: ['cli'],
      createdBy: '@you'
    });

    await expectStatus(POST(makeEvent(room.id, invite.id, {
      password: 'wrong',
      kind: 'cli'
    })), 401);
  });
});
