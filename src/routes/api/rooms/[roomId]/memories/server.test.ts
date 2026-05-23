import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { addRoomMemory } from '$lib/server/roomMemoryStore';

const ADMIN_TOKEN_FOR_TESTS = 'room-memories-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const ORIGINAL_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

let vaultDir: string;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (ORIGINAL_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = ORIGINAL_DB_PATH;
  if (ORIGINAL_VAULT_PATH === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
  else process.env.OBSIDIAN_VAULT_PATH = ORIGINAL_VAULT_PATH;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
  vaultDir = mkdtempSync(join(tmpdir(), 'ant-room-memory-route-'));
  process.env.OBSIDIAN_VAULT_PATH = vaultDir;
});

function authHeaders(withAuth: boolean): Record<string, string> {
  return withAuth ? { authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` } : {};
}

function getEventFor(roomId: string, withAuth = true): GetEvent {
  return {
    params: { roomId },
    request: new Request(`http://localhost/api/rooms/${roomId}/memories`, {
      headers: authHeaders(withAuth)
    })
  } as unknown as GetEvent;
}

function postEventFor(roomId: string, body: Record<string, unknown>, withAuth = true): PostEvent {
  return {
    params: { roomId },
    request: new Request(`http://localhost/api/rooms/${roomId}/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(withAuth) },
      body: JSON.stringify(body)
    })
  } as unknown as PostEvent;
}

async function run(handler: typeof GET | typeof POST, event: GetEvent | PostEvent): Promise<Response> {
  try {
    return (await handler(event as never)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

function memoryFileCount(): number {
  return readdirSync(vaultDir).filter((file) => file.endsWith('.md')).length;
}

describe('GET/POST /api/rooms/:roomId/memories', () => {
  it('rejects unauthenticated reads before returning room memory content', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });
    addRoomMemory('Sensitive memory', 'Vault-only body', [room.id], ['probe']);

    const response = await run(GET, getEventFor(room.id, false));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Vault-only body');
  });

  it('allows authorised reads through the room read gate', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });
    addRoomMemory('Readable memory', 'Authorised body', [room.id], ['probe']);

    const response = await run(GET, getEventFor(room.id));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0]).toMatchObject({
      title: 'Readable memory',
      body: 'Authorised body',
      linkedRooms: [room.id]
    });
  });

  it('rejects unauthenticated writes without creating a vault file', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });
    expect(memoryFileCount()).toBe(0);

    const response = await run(POST, postEventFor(room.id, {
      title: 'Poisoned memory',
      body: 'This should not hit disk',
      tags: ['probe']
    }, false));

    expect(response.status).toBe(401);
    expect(memoryFileCount()).toBe(0);
  });

  it('allows authorised writes through the room mutation gate', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });

    const response = await run(POST, postEventFor(room.id, {
      title: 'Legit memory',
      body: 'Write is authorised',
      tags: ['probe']
    }));

    expect(response.status).toBe(201);
    expect(memoryFileCount()).toBe(1);
    const body = await response.json();
    expect(body.memory).toMatchObject({
      title: 'Legit memory',
      body: 'Write is authorised',
      linkedRooms: [room.id],
      tags: ['probe']
    });
  });
});
