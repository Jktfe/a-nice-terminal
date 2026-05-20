import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createInvite,
  resetChatInviteStoreForTests,
  MAX_FAILED_ATTEMPTS,
  type PublicInviteSummary
} from '$lib/server/chatInviteStore';

type HandlerEvent = Parameters<typeof POST>[0];

beforeEach(() => {
  resetChatInviteStoreForTests();
});

afterEach(() => {
  resetChatInviteStoreForTests();
});

function makePostEvent(inviteId: string, bodyValue: unknown): HandlerEvent {
  const bodyText = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  return {
    params: { inviteId },
    request: new Request(`http://test.local/api/chat-invites/${inviteId}/exchange`, {
      method: 'POST',
      body: bodyText
    })
  } as unknown as HandlerEvent;
}

function seedInvite(overrides: Partial<{ password: string; kinds: ('cli' | 'mcp' | 'web')[] }> = {}): PublicInviteSummary {
  return createInvite({
    roomId: 'room-a',
    label: 'Team invite',
    password: overrides.password ?? 'correct-horse-battery-staple',
    kinds: overrides.kinds ?? ['cli'],
    createdBy: '@claude2'
  });
}

async function expectStatus(promise: unknown, expected: number) {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

describe('chat-invites exchange endpoint', () => {
  it('POST returns 200 + tokenId/tokenSecret on right password', async () => {
    const invite = seedInvite();
    const response = await POST(makePostEvent(invite.id, { password: 'correct-horse-battery-staple', kind: 'cli', handle: '@guest' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { tokenId: string; tokenSecret: string; password_hash?: string; token_hash?: string };
    expect(body.tokenId).toMatch(/^tok_/);
    expect(body.tokenSecret).toMatch(/^[0-9a-f]+$/);
    expect(body.tokenSecret.length).toBeGreaterThanOrEqual(64);
    expect(body.password_hash).toBeUndefined();
    expect(body.token_hash).toBeUndefined();
  });

  it('POST returns 401 on wrong password (generic, no leak)', async () => {
    const invite = seedInvite();
    let captured: unknown = null;
    try {
      await POST(makePostEvent(invite.id, { password: 'WRONG', kind: 'cli' }));
    } catch (failure) {
      captured = failure;
    }
    expect((captured as { status?: number }).status).toBe(401);
    expect((captured as { body?: { message: string } }).body?.message ?? '').toBe('invite cannot be used');
  });

  it('POST returns 401 on revoked invite (same generic message)', async () => {
    const invite = seedInvite();
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      try { await POST(makePostEvent(invite.id, { password: 'WRONG', kind: 'cli' })); } catch { /* expected */ }
    }
    let captured: unknown = null;
    try {
      await POST(makePostEvent(invite.id, { password: 'correct-horse-battery-staple', kind: 'cli' }));
    } catch (failure) {
      captured = failure;
    }
    expect((captured as { status?: number }).status).toBe(401);
    expect((captured as { body?: { message: string } }).body?.message ?? '').toBe('invite cannot be used');
  });

  it('POST returns 401 on unknown inviteId (still generic — no leak about which condition)', async () => {
    await expectStatus(POST(makePostEvent('inv_does_not_exist', { password: 'whatever', kind: 'cli' })), 401);
  });

  it('POST returns 400 on missing body/empty body/array body/null body', async () => {
    const invite = seedInvite();
    await expectStatus(POST(makePostEvent(invite.id, 'not-json{')), 400);
    await expectStatus(POST(makePostEvent(invite.id, '')), 400);
    await expectStatus(POST(makePostEvent(invite.id, [])), 400);
    await expectStatus(POST(makePostEvent(invite.id, null)), 400);
  });

  it('POST returns 400 on missing password / missing kind / bad kind enum', async () => {
    const invite = seedInvite();
    await expectStatus(POST(makePostEvent(invite.id, { kind: 'cli' })), 400);
    await expectStatus(POST(makePostEvent(invite.id, { password: 'x' })), 400);
    await expectStatus(POST(makePostEvent(invite.id, { password: 'x', kind: 'notakind' })), 400);
  });

  it('POST returns 400 on kind not permitted by invite (kind-mismatch is 400, not 401)', async () => {
    const invite = seedInvite({ kinds: ['cli'] });
    await expectStatus(POST(makePostEvent(invite.id, { password: 'correct-horse-battery-staple', kind: 'web' })), 400);
  });

  it('POST returns 400 on empty URL inviteId', async () => {
    await expectStatus(POST(makePostEvent('', { password: 'x', kind: 'cli' })), 400);
  });
});
