import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetChatInviteStoreForTests, verifyToken } from '$lib/server/chatInviteStore';
import { createMcpGrant, resetMcpGrantStoreForTests } from '$lib/server/mcpGrantStore';
import { POST } from './+server';

type PostEvent = Parameters<typeof POST>[0];

const ADMIN_TOKEN = 'mcp-revoke-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatInviteStoreForTests();
  resetMcpGrantStoreForTests();
});

afterEach(() => {
  resetMcpGrantStoreForTests();
  resetChatInviteStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function headers(token = ADMIN_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function eventFor(tokenId: string, requestHeaders = headers()): PostEvent {
  return {
    params: { tokenId },
    request: new Request(`http://test.local/api/mcp/grants/${tokenId}/revoke`, {
      method: 'POST',
      headers: requestHeaders
    })
  } as PostEvent;
}

async function runHandler(event: PostEvent): Promise<Response> {
  try {
    return (await POST(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

function seedMcpGrant(): ReturnType<typeof createMcpGrant> {
  const room = createChatRoom({ name: 'mcp room', whoCreatedIt: '@owner' });
  return createMcpGrant({ roomId: room.id, handle: '@mcp', label: 'Claude Desktop' });
}

describe('POST /api/mcp/grants/:tokenId/revoke', () => {
  it('requires admin bearer auth before revoking the grant', async () => {
    const created = seedMcpGrant();

    const response = await runHandler(eventFor(created.grant.token_id, {}));

    expect(response.status).toBe(401);
    expect(verifyToken(created.tokenSecret, created.grant.room_id)).not.toBeNull();
  });

  it('returns 400 for a missing token id', async () => {
    const response = await runHandler(eventFor(''));

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown token id', async () => {
    const response = await runHandler(eventFor('tok_missing'));

    expect(response.status).toBe(404);
  });

  it('revokes idempotently, invalidates the invite token, and never returns token bytes', async () => {
    const created = seedMcpGrant();
    expect(verifyToken(created.tokenSecret, created.grant.room_id)).not.toBeNull();

    const first = await runHandler(eventFor(created.grant.token_id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      token_id: created.grant.token_id,
      revoked: true,
      grant: {
        token_id: created.grant.token_id,
        revoked_at: expect.any(String)
      }
    });
    expect(JSON.stringify(firstBody)).not.toContain(created.tokenSecret);
    expect(JSON.stringify(firstBody)).not.toContain('hash');
    expect(verifyToken(created.tokenSecret, created.grant.room_id)).toBeNull();

    const second = await runHandler(eventFor(created.grant.token_id));
    expect(second.status).toBe(200);
  });
});
