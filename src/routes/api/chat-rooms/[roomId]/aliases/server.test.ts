/**
 * Endpoint tests for GET/POST/DELETE /api/chat-rooms/:roomId/aliases.
 *
 * Focus on the fail-closed contract: malformed bodies, unknown rooms, and
 * non-member handles must never look successful.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST, DELETE } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  findAliasForHandleInRoom,
  resetChatRoomAliasStoreForTests,
  setRoomAlias
} from '$lib/server/chatRoomAliasStore';

// Aliases POST/DELETE require chatRoomAuthGate (any room-authenticated caller
// passes); PID-as-identity model 2026-05-21 dropped the prior caller-must-be-
// target anti-spoof so any in-room caller can rename any member. Tests supply
// admin Bearer by default; the "any room member can alias anyone" expansion
// is covered by the positive POST/DELETE tests below using an admin caller
// against arbitrary targets (the spoof guard was the only thing blocking
// that path on a non-admin caller too).
const ADMIN_TOKEN_FOR_TESTS = 'aliases-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type PostOptions = { roomId: string; body?: string; withAuth?: boolean };
type GetOptions = { roomId: string };
type DeleteOptions = { roomId: string; query?: string; withAuth?: boolean };

function eventFor(
  method: 'GET' | 'POST' | 'DELETE',
  roomId: string,
  body?: string,
  query = '',
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/aliases${query}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url.toString(), { method, headers, body });
  return {
    request,
    params: { roomId },
    url
  } as unknown as Parameters<typeof POST>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof POST>[0]) => unknown,
  event: Parameters<typeof POST>[0]
): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

async function callAliasesGet(options: GetOptions): Promise<Response> {
  return runHandler(GET, eventFor('GET', options.roomId));
}

async function callAliasesPost(options: PostOptions): Promise<Response> {
  return runHandler(
    POST,
    eventFor('POST', options.roomId, options.body, '', options.withAuth !== false)
  );
}

async function callAliasesDelete(options: DeleteOptions): Promise<Response> {
  return runHandler(
    DELETE,
    eventFor('DELETE', options.roomId, undefined, options.query ?? '', options.withAuth !== false)
  );
}

describe('/api/chat-rooms/:roomId/aliases', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatRoomAliasStoreForTests();
  });

  it('GET returns 200 with the alias list for a known room', async () => {
    const room = createChatRoom({ name: 'list-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });

    const response = await callAliasesGet({ roomId: room.id });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { aliases: { alias: string }[] };
    expect(body.aliases).toHaveLength(1);
    expect(body.aliases[0].alias).toBe('@cdx');
  });

  it('GET returns 404 for an unknown room', async () => {
    const response = await callAliasesGet({ roomId: 'doesnotexist' });
    expect(response.status).toBe(404);
  });

  it('POST returns 201 and saves the alias on a valid body', async () => {
    const room = createChatRoom({ name: 'post-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const response = await callAliasesPost({
      roomId: room.id,
      body: JSON.stringify({ globalHandle: '@evolveantcodex', newAlias: '@cdx' })
    });

    expect(response.status).toBe(201);
    expect(findAliasForHandleInRoom(room.id, '@evolveantcodex')).toBe('@cdx');
  });

  it('POST returns 404 when the room is unknown, before any store call', async () => {
    const response = await callAliasesPost({
      roomId: 'doesnotexist',
      body: JSON.stringify({ globalHandle: '@x', newAlias: '@y' })
    });
    expect(response.status).toBe(404);
  });

  it('POST returns 400 when the body is empty', async () => {
    const room = createChatRoom({ name: 'empty-body', whoCreatedIt: '@you' });
    const response = await callAliasesPost({ roomId: room.id, body: '' });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when the body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'malformed-body', whoCreatedIt: '@you' });
    const response = await callAliasesPost({
      roomId: room.id,
      body: '{ not valid json'
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when the body parses to a non-object (e.g. an array)', async () => {
    const room = createChatRoom({ name: 'array-body', whoCreatedIt: '@you' });
    const response = await callAliasesPost({
      roomId: room.id,
      body: JSON.stringify(['globalHandle', 'newAlias'])
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when globalHandle is missing', async () => {
    const room = createChatRoom({ name: 'no-handle', whoCreatedIt: '@you' });
    const response = await callAliasesPost({
      roomId: room.id,
      body: JSON.stringify({ newAlias: '@cdx' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when newAlias is missing', async () => {
    const room = createChatRoom({ name: 'no-alias', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    const response = await callAliasesPost({
      roomId: room.id,
      body: JSON.stringify({ globalHandle: '@x' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 409 with collidesWith when the alias is already taken', async () => {
    const room = createChatRoom({ name: 'collide', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });

    const response = await callAliasesPost({
      roomId: room.id,
      body: JSON.stringify({ globalHandle: '@evolveantclaude', newAlias: '@cdx' })
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { alias: string; collidesWith: string };
    expect(body.alias).toBe('@cdx');
    expect(body.collidesWith).toBe('@evolveantcodex');
  });

  it('DELETE returns 204 and clears the alias for a known room/member', async () => {
    const room = createChatRoom({ name: 'delete-existing', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@xx' });

    const response = await callAliasesDelete({
      roomId: room.id,
      query: '?globalHandle=' + encodeURIComponent('@x')
    });

    expect(response.status).toBe(204);
    expect(findAliasForHandleInRoom(room.id, '@x')).toBeUndefined();
  });

  it('DELETE is idempotent when the member has no alias set', async () => {
    const room = createChatRoom({ name: 'delete-noop', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });

    const response = await callAliasesDelete({
      roomId: room.id,
      query: '?globalHandle=' + encodeURIComponent('@x')
    });

    expect(response.status).toBe(204);
  });

  it('DELETE returns 404 when the room is unknown', async () => {
    const response = await callAliasesDelete({
      roomId: 'doesnotexist',
      query: '?globalHandle=' + encodeURIComponent('@x')
    });
    expect(response.status).toBe(404);
  });

  it('DELETE returns 400 when globalHandle query is missing', async () => {
    const room = createChatRoom({ name: 'delete-missing', whoCreatedIt: '@you' });
    const response = await callAliasesDelete({ roomId: room.id, query: '' });
    expect(response.status).toBe(400);
  });

  it('DELETE returns 404 when the handle is not a member of the room', async () => {
    const room = createChatRoom({ name: 'delete-nonmember', whoCreatedIt: '@you' });
    const response = await callAliasesDelete({
      roomId: room.id,
      query: '?globalHandle=' + encodeURIComponent('@typo')
    });
    expect(response.status).toBe(404);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-alias-post', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    const response = await callAliasesPost({
      roomId: room.id,
      body: JSON.stringify({ globalHandle: '@x', newAlias: '@xx' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(findAliasForHandleInRoom(room.id, '@x')).toBeUndefined();
  });

  it('DELETE returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-alias-del', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@x' });
    setRoomAlias({ roomId: room.id, globalHandle: '@x', newAlias: '@xx' });
    const response = await callAliasesDelete({
      roomId: room.id,
      query: '?globalHandle=' + encodeURIComponent('@x'),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(findAliasForHandleInRoom(room.id, '@x')).toBe('@xx');
  });
});
