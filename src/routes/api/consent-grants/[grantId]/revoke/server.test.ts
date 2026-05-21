import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  createConsentGrant,
  listConsentGrants,
  resetConsentGrantStoreForTests
} from '$lib/server/consentGrantStore';
import { POST } from './+server';

type PostEvent = Parameters<typeof POST>[0];

const ADMIN_TOKEN = 'consent-revoke-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetConsentGrantStoreForTests();
});

afterEach(() => {
  resetConsentGrantStoreForTests();
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

function eventFor(grantId: string, body: unknown = {}, requestHeaders = headers()): PostEvent {
  return {
    params: { grantId },
    request: new Request(`http://test.local/api/consent-grants/${grantId}/revoke`, {
      method: 'POST',
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
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

function seedGrant(): ReturnType<typeof createConsentGrant> {
  const room = createChatRoom({ name: 'consent room', whoCreatedIt: '@owner' });
  return createConsentGrant({
    roomId: room.id,
    grantedTo: '@codex',
    topic: 'file-read',
    createdBy: '@owner'
  });
}

describe('POST /api/consent-grants/:grantId/revoke', () => {
  it('requires admin bearer auth before revoking a grant', async () => {
    const grant = seedGrant();

    const response = await runHandler(eventFor(grant.id, {}, {}));

    expect(response.status).toBe(401);
    expect(listConsentGrants({ includeInactive: true })[0].status).toBe('active');
  });

  it('revokes a grant and records the actor in the returned audit trail', async () => {
    const grant = seedGrant();

    const response = await runHandler(eventFor(grant.id, { revokedBy: '@you' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revoked).toBe(true);
    expect(body.grant).toMatchObject({
      id: grant.id,
      status: 'revoked',
      revokedBy: '@you'
    });
    expect(body.grant.auditTrail.at(-1)).toMatchObject({
      action: 'revoked',
      actorHandle: '@you'
    });
  });

  it('returns 400 for a missing grant id', async () => {
    const response = await runHandler(eventFor(''));

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown grant id', async () => {
    const response = await runHandler(eventFor('missing-grant'));

    expect(response.status).toBe(404);
  });
});
