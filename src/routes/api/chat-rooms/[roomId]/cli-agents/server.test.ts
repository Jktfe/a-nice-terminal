import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  registerCliAgentForTests,
  resetCliAgentRegistryForTests,
  type CliAgentHandle,
  type CliAgentKind
} from '$lib/server/cliAgentRegistry';

const PREVIOUS_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREVIOUS_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'room-cli-agents-test-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'GET' | 'POST',
  roomId: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Parameters<typeof GET>[0] {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/cli-agents`);
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json', ...headers };
  }
  return {
    request: new Request(url.toString(), init),
    params: { roomId },
    url
  } as Parameters<typeof GET>[0];
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
}

function fakeAgent(input: {
  handleId: string;
  cli: CliAgentKind;
  roomId: string | null;
  sessionId?: string | null;
}): CliAgentHandle {
  return {
    handleId: input.handleId,
    cli: input.cli,
    cwd: null,
    roomId: input.roomId,
    spawnedAtMs: Date.now(),
    getSessionId: () => input.sessionId ?? null,
    async sendCommand<TResult = unknown>(): Promise<TResult> {
      return {} as TResult;
    },
    async sendPrompt() {
      return { threadId: input.sessionId ?? null };
    },
    async stop() {}
  };
}

describe('/api/chat-rooms/:roomId/cli-agents', () => {
  beforeEach(() => {
    process.env.ANT_FRESH_DB_PATH = ':memory:';
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetCliAgentRegistryForTests();
  });

  afterEach(() => {
    resetCliAgentRegistryForTests();
    resetChatRoomStoreForTests();
    resetIdentityDbForTests();
    if (PREVIOUS_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = PREVIOUS_DB_PATH;
    if (PREVIOUS_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREVIOUS_ADMIN_TOKEN;
  });

  it('GET requires room read access before listing room-scoped CLI agents', async () => {
    const room = createChatRoom({ name: 'room-cli-agents', whoCreatedIt: '@you' });
    registerCliAgentForTests(fakeAgent({
      handleId: 'agent-room',
      cli: 'codex',
      roomId: room.id,
      sessionId: 'thread-room'
    }));

    const response = await runHandler(GET as unknown as AnyHandler, eventFor('GET', room.id));

    expect(response.status).toBe(401);
  });

  it('GET returns only agents registered for the room when authenticated', async () => {
    const room = createChatRoom({ name: 'room-cli-agents', whoCreatedIt: '@you' });
    const otherRoom = createChatRoom({ name: 'other-room', whoCreatedIt: '@you' });
    registerCliAgentForTests(fakeAgent({
      handleId: 'agent-room',
      cli: 'codex',
      roomId: room.id,
      sessionId: 'thread-room'
    }));
    registerCliAgentForTests(fakeAgent({
      handleId: 'agent-other',
      cli: 'pi',
      roomId: otherRoom.id,
      sessionId: 'pi-other'
    }));
    registerCliAgentForTests(fakeAgent({
      handleId: 'agent-global',
      cli: 'codex',
      roomId: null,
      sessionId: 'thread-global'
    }));

    const response = await runHandler(
      GET as unknown as AnyHandler,
      eventFor('GET', room.id, undefined, adminHeaders())
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { agents: Array<{ handleId: string; sessionId: string | null }> };
    expect(body.agents).toEqual([
      expect.objectContaining({ handleId: 'agent-room', sessionId: 'thread-room' })
    ]);
  });

  it('POST requires room mutation auth before validating or spawning CLI agents', async () => {
    const room = createChatRoom({ name: 'room-cli-agents', whoCreatedIt: '@you' });

    const response = await runHandler(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, { cli: 'codex' })
    );

    expect(response.status).toBe(401);

    const listResponse = await runHandler(
      GET as unknown as AnyHandler,
      eventFor('GET', room.id, undefined, adminHeaders())
    );
    const body = await listResponse.json() as { agents: unknown[] };
    expect(body.agents).toEqual([]);
  });

  it('POST keeps the remote-bridge bearer spawn-locality 403', async () => {
    const room = createChatRoom({ name: 'room-cli-agents', whoCreatedIt: '@you' });

    const response = await runHandler(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, { cli: 'codex' }, { authorization: 'Bearer rbt_test' })
    );

    expect(response.status).toBe(403);
  });

  it('POST validates CLI kind after authentication succeeds', async () => {
    const room = createChatRoom({ name: 'room-cli-agents', whoCreatedIt: '@you' });

    const response = await runHandler(
      POST as unknown as AnyHandler,
      eventFor('POST', room.id, { cli: 'gemini' }, adminHeaders())
    );

    expect(response.status).toBe(400);
  });
});
