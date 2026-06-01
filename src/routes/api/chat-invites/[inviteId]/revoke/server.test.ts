import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  resetChatInviteStoreForTests,
  createInvite,
  exchangePasswordForToken,
  verifyToken
} from '$lib/server/chatInviteStore';

type Event = Parameters<typeof POST>[0];
const ADMIN_TOKEN = 'admin-secret-xyz';

beforeEach(() => {
  resetChatInviteStoreForTests();
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
});

afterEach(() => {
  resetChatInviteStoreForTests();
  delete process.env.ANT_ADMIN_TOKEN;
});

function makeRevokeEvent(inviteId: string, opts: { auth?: string | null } = {}): Event {
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = `Bearer ${opts.auth ?? ADMIN_TOKEN}`;
  return {
    params: { inviteId },
    request: new Request(`http://test.local/api/chat-invites/${inviteId}/revoke`, { method: 'POST', headers })
  } as unknown as Event;
}

async function expectStatus(promise: unknown, expected: number) {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

function seedInvite() {
  return createInvite({
    roomId: 'room-a',
    label: 'team',
    password: 'correct-horse-battery-staple',
    kinds: ['cli'],
    createdBy: '@admin'
  });
}

describe('POST /api/chat-invites/:inviteId/revoke', () => {
  it('200 + invite_id + revoked:true on first revoke', async () => {
    const invite = seedInvite();
    const response = (await POST(makeRevokeEvent(invite.id))) as Response;
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ invite_id: invite.id, revoked: true });
  });

  it('200 idempotent on second revoke (already revoked returns same 200)', async () => {
    const invite = seedInvite();
    await POST(makeRevokeEvent(invite.id));
    const response = (await POST(makeRevokeEvent(invite.id))) as Response;
    expect(response.status).toBe(200);
  });

  it('401 when admin bearer missing', async () => {
    const invite = seedInvite();
    await expectStatus(POST(makeRevokeEvent(invite.id, { auth: null })), 401);
  });

  it('401 when admin bearer is wrong', async () => {
    const invite = seedInvite();
    await expectStatus(POST(makeRevokeEvent(invite.id, { auth: 'wrong-token' })), 401);
  });

  it('404 when invite id does not exist', async () => {
    await expectStatus(POST(makeRevokeEvent('phantom-invite')), 404);
  });

  it('503 when ANT_ADMIN_TOKEN env is unset (fail-closed)', async () => {
    const invite = seedInvite();
    delete process.env.ANT_ADMIN_TOKEN;
    await expectStatus(POST(makeRevokeEvent(invite.id)), 503);
  });

  it('CASCADE: derived tokens become unusable after invite revoke', async () => {
    const invite = seedInvite();
    const exchange = exchangePasswordForToken({
      inviteId: invite.id,
      password: 'correct-horse-battery-staple',
      kind: 'cli',
      handle: '@new-member'
    });
    expect(verifyToken(exchange.tokenSecret, invite.room_id)).toBeTruthy();
    await POST(makeRevokeEvent(invite.id));
    expect(verifyToken(exchange.tokenSecret, invite.room_id)).toBeNull();
  });
});
