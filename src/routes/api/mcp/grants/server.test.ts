import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { resetChatInviteStoreForTests, verifyToken } from '$lib/server/chatInviteStore';
import { resetMcpGrantStoreForTests } from '$lib/server/mcpGrantStore';
import { GET, POST } from './+server';
import { POST as REVOKE } from './[tokenId]/revoke/+server';

type RootEvent = Parameters<typeof POST>[0];
type GetEvent = Parameters<typeof GET>[0];
type RevokeEvent = Parameters<typeof REVOKE>[0];

const ADMIN_TOKEN = 'mcp-admin-token';
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatInviteStoreForTests();
  resetMcpGrantStoreForTests();
});

afterEach(() => {
  resetMcpGrantStoreForTests();
  resetChatInviteStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB;
  if (PREV_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN;
});

function authHeaders(token = ADMIN_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function rootPost(bodyValue: unknown, headers = authHeaders()): RootEvent {
  const body = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  return {
    request: new Request('http://test.local/api/mcp/grants', { method: 'POST', body, headers })
  } as RootEvent;
}

function rootGet(roomId: string | null, extra = '', headers = authHeaders()): GetEvent {
  const query = roomId === null ? '' : `?roomId=${encodeURIComponent(roomId)}${extra}`;
  return {
    url: new URL(`http://test.local/api/mcp/grants${query}`),
    request: new Request(`http://test.local/api/mcp/grants${query}`, { method: 'GET', headers })
  } as GetEvent;
}

function revokePost(tokenId: string, headers = authHeaders()): RevokeEvent {
  return {
    params: { tokenId },
    request: new Request(`http://test.local/api/mcp/grants/${tokenId}/revoke`, { method: 'POST', headers })
  } as unknown as RevokeEvent;
}

async function expectStatus(promise: unknown, expected: number): Promise<void> {
  let captured: unknown = null;
  try { await promise; } catch (failure) { captured = failure; }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expected);
}

function makeRoom(): string {
  return createChatRoom({ name: 'mcp-room', whoCreatedIt: '@owner' }).id;
}

describe('/api/mcp/grants routes', () => {
  it('GET requires admin bearer and roomId', async () => {
    await expectStatus(GET(rootGet('room-a', '', {})), 401);
    await expectStatus(GET(rootGet(null)), 400);
  });

  it('GET returns 404 for unknown room', async () => {
    await expectStatus(GET(rootGet('missing-room')), 404);
  });

  it('POST requires admin bearer', async () => {
    const roomId = makeRoom();
    await expectStatus(POST(rootPost({ roomId, handle: '@mcp' }, {})), 401);
    await expectStatus(POST(rootPost({ roomId, handle: '@mcp' }, authHeaders('wrong'))), 401);
  });

  it('POST returns 400 for malformed or missing fields', async () => {
    const roomId = makeRoom();
    await expectStatus(POST(rootPost('not-json')), 400);
    await expectStatus(POST(rootPost({ roomId, label: 'missing handle' })), 400);
    await expectStatus(POST(rootPost({ roomId, handle: '@mcp', label: 42 })), 400);
  });

  it('POST returns 404 for unknown room', async () => {
    await expectStatus(POST(rootPost({ roomId: 'missing-room', handle: '@mcp' })), 404);
  });

  it('POST creates an mcp grant and returns the token secret exactly on create', async () => {
    const roomId = makeRoom();
    const response = await POST(rootPost({ roomId, handle: 'mcp', label: 'Claude Desktop' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tokenSecret).toMatch(/^[0-9a-f]+$/);
    expect(body.grant).toMatchObject({ room_id: roomId, handle: '@mcp', label: 'Claude Desktop' });
    expect(JSON.stringify(body.grant)).not.toContain(body.tokenSecret);
    expect(verifyToken(body.tokenSecret, roomId)).toMatchObject({ kind: 'mcp', handle: '@mcp' });
  });

  it('GET lists active mcp grant metadata only and omits revoked by default', async () => {
    const roomId = makeRoom();
    const created = await (await POST(rootPost({ roomId, handle: '@mcp', label: 'Claude Code' }))).json();
    await REVOKE(revokePost(created.grant.token_id));
    const active = await (await GET(rootGet(roomId))).json();
    expect(active.grants).toEqual([]);
    const withRevoked = await (await GET(rootGet(roomId, '&includeRevoked=1'))).json();
    expect(withRevoked.grants).toHaveLength(1);
    expect(JSON.stringify(withRevoked.grants[0])).not.toContain(created.tokenSecret);
    expect(JSON.stringify(withRevoked.grants[0])).not.toContain('hash');
  });

  it('revoke requires admin bearer and 404s unknown token', async () => {
    await expectStatus(REVOKE(revokePost('tok_missing', {})), 401);
    await expectStatus(REVOKE(revokePost('tok_missing')), 404);
  });

  it('revoke invalidates token and returns no token bytes, idempotently', async () => {
    const roomId = makeRoom();
    const created = await (await POST(rootPost({ roomId, handle: '@mcp' }))).json();
    expect(verifyToken(created.tokenSecret, roomId)).not.toBeNull();
    const first = await REVOKE(revokePost(created.grant.token_id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ token_id: created.grant.token_id, revoked: true });
    expect(JSON.stringify(firstBody)).not.toContain(created.tokenSecret);
    expect(JSON.stringify(firstBody)).not.toContain('hash');
    expect(verifyToken(created.tokenSecret, roomId)).toBeNull();
    const second = await REVOKE(revokePost(created.grant.token_id));
    expect(second.status).toBe(200);
  });
});
