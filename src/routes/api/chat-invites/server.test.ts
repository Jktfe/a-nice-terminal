import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetChatInviteStoreForTests } from '$lib/server/chatInviteStore';

type HandlerEvent = Parameters<typeof POST>[0];

const ADMIN_TOKEN = 'admin-secret-xyz';

beforeEach(() => {
  resetChatInviteStoreForTests();
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
});

afterEach(() => {
  resetChatInviteStoreForTests();
  delete process.env.ANT_ADMIN_TOKEN;
});

function makePostEvent(bodyValue: unknown, opts: { auth?: string | null } = {}): HandlerEvent {
  const bodyText = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  const headers: Record<string, string> = {};
  if (opts.auth !== null) {
    headers.authorization = `Bearer ${opts.auth ?? ADMIN_TOKEN}`;
  }
  return {
    request: new Request('http://test.local/api/chat-invites', { method: 'POST', body: bodyText, headers })
  } as unknown as HandlerEvent;
}

function makeGetEvent(roomId: string | null, opts: { auth?: string | null } = {}): HandlerEvent {
  const headers: Record<string, string> = {};
  if (opts.auth !== null) {
    headers.authorization = `Bearer ${opts.auth ?? ADMIN_TOKEN}`;
  }
  const search = roomId === null ? '' : `?roomId=${encodeURIComponent(roomId)}`;
  return {
    url: new URL(`http://test.local/api/chat-invites${search}`),
    request: new Request(`http://test.local/api/chat-invites${search}`, { method: 'GET', headers })
  } as unknown as HandlerEvent;
}

const validBody = () => ({
  roomId: 'room-a',
  label: 'Team invite',
  password: 'correct-horse-battery-staple',
  kinds: ['cli'],
  createdBy: '@claude2'
});

async function expectStatus(promise: unknown, expected: number) {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

describe('chat-invites POST + GET admin endpoint', () => {
  it('POST returns 503 when ANT_ADMIN_TOKEN env is unset', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    await expectStatus(POST(makePostEvent(validBody())), 503);
  });

  it('POST returns 401 when authorization header is missing', async () => {
    await expectStatus(POST(makePostEvent(validBody(), { auth: null })), 401);
  });

  it('POST returns 401 on wrong bearer', async () => {
    await expectStatus(POST(makePostEvent(validBody(), { auth: 'wrong-token' })), 401);
  });

  it('POST returns 200 + safe invite shape with right bearer', async () => {
    const response = await POST(makePostEvent(validBody()));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invite: Record<string, unknown> };
    expect(body.invite.id).toMatch(/^inv_/);
    expect(body.invite.password_hash).toBeUndefined();
  });

  it('POST returns 400 on missing roomId/label/password/kinds', async () => {
    await expectStatus(POST(makePostEvent({ ...validBody(), roomId: '' })), 400);
    await expectStatus(POST(makePostEvent({ ...validBody(), label: '' })), 400);
    await expectStatus(POST(makePostEvent({ ...validBody(), password: '' })), 400);
    await expectStatus(POST(makePostEvent({ ...validBody(), kinds: [] })), 400);
    await expectStatus(POST(makePostEvent({ ...validBody(), kinds: ['notakind'] })), 400);
  });

  it('POST returns 400 on too-short password', async () => {
    await expectStatus(POST(makePostEvent({ ...validBody(), password: 'a' })), 400);
  });

  it('GET requires admin bearer + roomId', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    await expectStatus(GET(makeGetEvent('room-a')), 503);
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    await expectStatus(GET(makeGetEvent('room-a', { auth: null })), 401);
    await expectStatus(GET(makeGetEvent(null)), 400);
    await POST(makePostEvent(validBody()));
    const response = await GET(makeGetEvent('room-a'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invites: Array<{ id: string; password_hash?: string }> };
    expect(body.invites.length).toBe(1);
    expect(body.invites[0].password_hash).toBeUndefined();
  });
});
