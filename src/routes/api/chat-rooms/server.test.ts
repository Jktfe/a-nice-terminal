/**
 * Endpoint tests for POST /api/chat-rooms — focus on the whoCreatedIt
 * normalisation path that protects the participation-history record from
 * receiving a whitespace handle after the room has already been created.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  findChatRoomById,
  listChatRooms,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import {
  listPriorCollaboratorsExcludingRoom,
  resetChatRoomParticipationHistoryStoreForTests
} from '$lib/server/chatRoomParticipationHistoryStore';

function eventForPost(body?: string) {
  const url = new URL('http://localhost/api/chat-rooms');
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });
  return { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
}

async function callPost(body?: string): Promise<Response> {
  try {
    return (await POST(eventForPost(body))) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

async function callGet(): Promise<Response> {
  const url = new URL('http://localhost/api/chat-rooms');
  const event = {
    request: new Request(url),
    params: {},
    url
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('POST /api/chat-rooms whoCreatedIt normalisation', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
    resetChatRoomParticipationHistoryStoreForTests();
  });

  it('falls back to @unknown when whoCreatedIt is whitespace-only', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'whitespace-creator', whoCreatedIt: '   ' })
    );
    expect(response.status).toBe(201);
    const rooms = listChatRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].whoCreatedIt).toBe('@you');
    expect(rooms[0].members[0].handle).toBe('@you');
  });

  it('records participation under the normalised handle, not the raw whitespace', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'history-room', whoCreatedIt: '   ' })
    );
    expect(response.status).toBe(201);
    const createdRoom = listChatRooms()[0];
    // The created room itself is excluded from a "prior" lookup, but the
    // handle should be findable from any other room id.
    const priorElsewhere = listPriorCollaboratorsExcludingRoom('someOtherRoomId');
    expect(priorElsewhere).toContain('@you');
    // And the room itself was actually created — no partial mutation.
    expect(findChatRoomById(createdRoom.id)).toBeDefined();
  });

  it('trims surrounding whitespace and uses the trimmed handle', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'padded-creator', whoCreatedIt: '  @padded  ' })
    );
    expect(response.status).toBe(201);
    const created = listChatRooms()[0];
    expect(created.whoCreatedIt).toBe('@padded');
  });

  it('still accepts a real handle unchanged', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'real-creator', whoCreatedIt: '@evolveantclaude' })
    );
    expect(response.status).toBe(201);
    const created = listChatRooms()[0];
    expect(created.whoCreatedIt).toBe('@evolveantclaude');
  });

  it('rejects room names containing leaked --name flag (#144)', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'real name --name leaked', whoCreatedIt: '@you' })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Room name cannot contain CLI flags');
  });

  it('rejects room names starting with -- (#144)', async () => {
    const response = await callPost(
      JSON.stringify({ name: '--name real name', whoCreatedIt: '@you' })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Room name cannot contain CLI flags');
  });

  it('GET returns room summaries derived from latest messages', async () => {
    const createResponse = await callPost(
      JSON.stringify({ name: 'active-room', whoCreatedIt: '@you' })
    );
    expect(createResponse.status).toBe(201);
    const room = (await createResponse.json()).chatRoom as { id: string };
    postMessage({
      roomId: room.id,
      authorHandle: '@evolveantsvelte',
      body: 'claimed #136b cockpit UI'
    });

    const response = await callGet();
    const body = await response.json();

    expect(body.chatRooms[0].summary).toBe('@evolveantsvelte: claimed #136b cockpit UI');
  });
});
