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
  removeMemberFromRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { issueToken, resetAntchatAuthTokensForTests } from '$lib/server/antchatAuthStore';
import {
  listPriorCollaboratorsExcludingRoom,
  resetChatRoomParticipationHistoryStoreForTests
} from '$lib/server/chatRoomParticipationHistoryStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { adoptExternalProcessForTerminal } from '$lib/server/terminalsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';

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

async function callGet(headers: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/chat-rooms');
  const event = {
    request: new Request(url, { headers }),
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
    resetIdentityDbForTests();
    resetChatMessageStoreForTests();
    resetAntchatAuthTokensForTests();
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

  it('binds an agent-created room to the live terminal record', async () => {
    const record = createTerminalRecord({
      sessionId: 'claude-live-session',
      name: 'evolveantclaude',
      handle: '@evolveantclaude',
      agentKind: 'claude',
      tmuxTargetPane: 'claude-live-session:0.0'
    });
    adoptExternalProcessForTerminal({
      record,
      pid: 5151,
      pidStart: 'pid-start-claude',
      ttlSeconds: 3600
    });

    const response = await callPost(
      JSON.stringify({ name: 'claude side room', whoCreatedIt: '@evolveantclaude' })
    );

    expect(response.status).toBe(201);
    const created = listChatRooms()[0];
    expect(getTerminalIdByHandle(created.id, '@evolveantclaude')).toBe('claude-live-session');
    expect(created.members.find((member) => member.handle === '@evolveantclaude')?.kind).toBe('agent');
  });

  it('renders legacy human creator rows as agent when a terminal record exists', async () => {
    await callPost(JSON.stringify({ name: 'legacy side room', whoCreatedIt: '@evolveantcodex' }));
    const createdBeforeRecord = listChatRooms()[0];
    expect(createdBeforeRecord.members.find((member) => member.handle === '@evolveantcodex')?.kind)
      .toBe('human');

    createTerminalRecord({
      sessionId: 'codex-live-session',
      name: 'evolveantcodex',
      handle: '@evolveantcodex',
      agentKind: 'codex',
      tmuxTargetPane: 'codex-live-session:0.0'
    });

    const repaired = findChatRoomById(createdBeforeRecord.id);
    expect(repaired?.members.find((member) => member.handle === '@evolveantcodex')?.kind)
      .toBe('agent');
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

  it('persists optional description from POST body so the new room lands populated', async () => {
    // Form sends { name, whoCreatedIt, description } in one shot instead of
    // POST + PATCH /description. The created room should carry the
    // trimmed description back in the response.
    const response = await callPost(
      JSON.stringify({
        name: 'described-room',
        whoCreatedIt: '@you',
        description: '   Quarterly board prep.  '
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.chatRoom.name).toBe('described-room');
    expect(body.chatRoom.description).toBe('Quarterly board prep.');
  });

  it('treats empty/whitespace description as null on create', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'empty-desc-room', whoCreatedIt: '@you', description: '   ' })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.chatRoom.description).toBeNull();
  });

  it('rejects non-string non-null description from POST body with 400', async () => {
    const response = await callPost(
      JSON.stringify({ name: 'bad-desc', whoCreatedIt: '@you', description: 42 })
    );
    expect(response.status).toBe(400);
  });

  it('GET rejects unauthenticated room-list reads', async () => {
    await callPost(JSON.stringify({ name: 'private-room', whoCreatedIt: '@you' }));

    const response = await callGet();

    expect(response.status).toBe(401);
  });

  it('GET filters rooms to the authenticated antchat bearer handle', async () => {
    const jamesRoom = (await (await callPost(
      JSON.stringify({ name: 'james room', whoCreatedIt: '@jamesm5' })
    )).json()).chatRoom as { id: string };
    await callPost(JSON.stringify({ name: 'operator room', whoCreatedIt: '@you' }));
    const { token } = issueToken('redacted@example.com');

    const response = await callGet({ authorization: `Bearer ${token}` });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chatRooms.map((room: { id: string }) => room.id)).toEqual([jamesRoom.id]);
  });

  it('GET expands a user bearer to their owned agent family', async () => {
    const agentRoom = (await (await callPost(
      JSON.stringify({ name: 'james-agent-room', whoCreatedIt: '@antmacdevcodex' })
    )).json()).chatRoom as { id: string };
    const markRoom = (await (await callPost(
      JSON.stringify({ name: 'mark-room', whoCreatedIt: '@mark' })
    )).json()).chatRoom as { id: string };
    removeMemberFromRoom({ roomId: markRoom.id, globalHandle: '@you' });
    const { token } = issueToken('redacted@example.com');

    const response = await callGet({ authorization: `Bearer ${token}` });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chatRooms.map((room: { id: string }) => room.id)).toContain(agentRoom.id);
    expect(body.chatRooms.map((room: { name: string }) => room.name)).not.toContain('mark-room');
  });

  it('GET expands a user bearer to their owned agent without crossing owners', async () => {
    const serverLaptopRoom = (await (await callPost(
      JSON.stringify({ name: 'serverlaptop-room', whoCreatedIt: '@serverlaptop' })
    )).json()).chatRoom as { id: string };
    const { token } = issueToken('redacted@example.com');

    const response = await callGet({ authorization: `Bearer ${token}` });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chatRooms.map((room: { id: string }) => room.id)).not.toContain(serverLaptopRoom.id);
  });

  it('GET treats serverlaptop as James-owned, not Mark-owned', async () => {
    const serverLaptopRoom = (await (await callPost(
      JSON.stringify({ name: 'serverlaptop-room', whoCreatedIt: '@serverlaptop' })
    )).json()).chatRoom as { id: string };
    const { token } = issueToken('redacted@example.com');

    const response = await callGet({ authorization: `Bearer ${token}` });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chatRooms.map((room: { id: string }) => room.id)).toContain(serverLaptopRoom.id);
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

    const { token } = issueToken('you@example.com');
    const response = await callGet({ authorization: `Bearer ${token}` });
    const body = await response.json();

    expect(body.chatRooms[0].summary).toBe('@evolveantsvelte: claimed #136b cockpit UI');
  });
});
