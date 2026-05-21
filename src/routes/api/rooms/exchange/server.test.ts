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

function makeEvent(body: unknown): HandlerEvent {
  return {
    request: new Request('http://test.local/api/rooms/exchange', {
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

describe('legacy /api/rooms/exchange compatibility route', () => {
  it('accepts broad stale-client field aliases and returns a saved-token response', async () => {
    const room = createChatRoom({ name: 'legacy rooms exchange', whoCreatedIt: '@you' });
    const invite = createInvite({
      roomId: room.id,
      label: 'Legacy CLI',
      password: 'secret',
      kinds: ['cli'],
      createdBy: '@you'
    });

    const response = await POST(makeEvent({
      room_id: room.id,
      invite: invite.id,
      password: 'secret',
      handle: '@desktop-agent'
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.room_id).toBe(room.id);
    expect(body.invite_id).toBe(invite.id);
    expect(body.token).toEqual(body.tokenSecret);
    expect(body.handle).toBe('@desktop-agent');
  });

  it('returns 400 when the stale-client body omits room or invite', async () => {
    await expectStatus(POST(makeEvent({ password: 'secret' })), 400);
  });
});
