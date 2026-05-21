import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetConsentGrantStoreForTests } from '$lib/server/consentGrantStore';
import { GET, POST } from './+server';
import { POST as REVOKE } from './[grantId]/revoke/+server';

const ADMIN_TOKEN = 'consent-admin-token';
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetConsentGrantStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetConsentGrantStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB;
  if (PREV_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN;
});

function headers(token = ADMIN_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function roomId(): string {
  return createChatRoom({ name: 'consent-room', whoCreatedIt: '@owner' }).id;
}

function getEvent(query = '', h = headers()) {
  const url = `http://test.local/api/consent-grants${query}`;
  return { request: new Request(url, { headers: h }), url: new URL(url) } as Parameters<typeof GET>[0];
}

function postEvent(body: unknown, h = headers()) {
  return {
    request: new Request('http://test.local/api/consent-grants', {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

function revokeEvent(grantId: string, h = headers()) {
  return {
    params: { grantId },
    request: new Request(`http://test.local/api/consent-grants/${grantId}/revoke`, {
      method: 'POST',
      headers: h
    })
  } as Parameters<typeof REVOKE>[0];
}

async function expectStatus(run: () => unknown, expected: number): Promise<void> {
  let captured: unknown = null;
  try { await run(); } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

describe('/api/consent-grants', () => {
  it('requires admin bearer for list and create', async () => {
    await expectStatus(() => GET(getEvent('', {})), 401);
    await expectStatus(
      () => POST(postEvent({ roomId: 'r', grantedTo: '@codex', topic: 'file-read' }, {})),
      401
    );
  });

  it('creates and lists safe room-scoped grant metadata', async () => {
    const room = roomId();
    const createdResponse = await POST(postEvent({
      roomId: room,
      grantedTo: 'codex',
      topic: 'file-read',
      sourceSet: ['/tmp/a.txt'],
      duration: '1h',
      maxAnswers: 2,
      createdBy: '@owner'
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.grant).toMatchObject({
      roomId: room,
      grantedTo: '@codex',
      topic: 'file-read',
      sourceSet: ['/tmp/a.txt'],
      status: 'active'
    });

    const listedResponse = await GET(getEvent(`?roomId=${room}`));
    const listed = await listedResponse.json();
    expect(listed.grants).toHaveLength(1);
    expect(listed.grants[0].id).toBe(created.grant.id);
    expect(listed.grants[0].auditTrail[0]).toMatchObject({ action: 'created' });
  });

  it('revoke hides grants from active lists and includes audit when requested', async () => {
    const room = roomId();
    const created = await (await POST(postEvent({ roomId: room, grantedTo: '@codex', topic: 'file-read' }))).json();
    const revokeResponse = await REVOKE(revokeEvent(created.grant.id));
    expect(revokeResponse.status).toBe(200);
    const active = await (await GET(getEvent(`?roomId=${room}`))).json();
    expect(active.grants).toEqual([]);
    const inactive = await (await GET(getEvent(`?roomId=${room}&includeInactive=1`))).json();
    expect(inactive.grants[0]).toMatchObject({ id: created.grant.id, status: 'revoked' });
    expect(inactive.grants[0].auditTrail.at(-1)).toMatchObject({ action: 'revoked' });
  });
});
