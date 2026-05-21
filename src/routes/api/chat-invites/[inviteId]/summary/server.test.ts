import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInvite, resetChatInviteStoreForTests, revokeInvite } from '$lib/server/chatInviteStore';
import { GET } from './+server';

beforeEach(() => {
  resetChatInviteStoreForTests();
});

afterEach(() => {
  resetChatInviteStoreForTests();
});

function req(inviteId: string): Parameters<typeof GET>[0] {
  return {
    params: { inviteId }
  } as Parameters<typeof GET>[0];
}

function seedInvite() {
  return createInvite({
    roomId: 'room-a',
    label: 'Team invite',
    password: 'correct-horse-battery-staple',
    kinds: ['cli', 'web'],
    createdBy: '@codex'
  });
}

describe('GET /api/chat-invites/:inviteId/summary', () => {
  it('returns a public invite preview without secrets or token internals', async () => {
    const invite = seedInvite();

    const res = await GET(req(invite.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({
      inviteId: invite.id,
      roomId: 'room-a',
      label: 'Team invite',
      kindsAllowed: ['cli', 'web'],
      revoked: false
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('hash');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('failed');
  });

  it('surfaces revoked state while preserving the safe preview shape', async () => {
    const invite = seedInvite();
    revokeInvite(invite.id);

    const res = await GET(req(invite.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      inviteId: invite.id,
      roomId: 'room-a',
      revoked: true
    });
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('failed_attempts');
  });

  it('rejects missing and unknown invite ids', async () => {
    await expect(GET(req(''))).rejects.toMatchObject({ status: 400 });
    await expect(GET(req('inv_missing'))).rejects.toMatchObject({ status: 404 });
  });
});
