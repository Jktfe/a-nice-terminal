import { mkdirSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { addRoomMemory } from '$lib/server/roomMemoryStore';
import { putMemory } from '$lib/server/memoriesStore';

const ADMIN_TOKEN_FOR_TESTS = 'room-memories-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const ORIGINAL_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const ORIGINAL_MEMORY_VAULT_PATH = process.env.ANT_MEMORY_VAULT_PATH;

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

let vaultDir: string;
let memoryPackDir: string;

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
  if (ORIGINAL_MEMORY_VAULT_PATH === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = ORIGINAL_MEMORY_VAULT_PATH;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
  vaultDir = mkdtempSync(join(tmpdir(), 'ant-room-memory-route-'));
  if (memoryPackDir) rmSync(memoryPackDir, { recursive: true, force: true });
  memoryPackDir = mkdtempSync(join(tmpdir(), 'ant-memory-pack-route-'));
  process.env.OBSIDIAN_VAULT_PATH = vaultDir;
  process.env.ANT_MEMORY_VAULT_PATH = memoryPackDir;
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

  it('includes room-scoped key/value memories in the room memory feed', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });
    putMemory({
      key: 'room.joint-answer-signoff-protocol.v1',
      value: 'Presenter chosen, peer signs off, final cites evidence.',
      scope: 'room',
      scopeTarget: room.id,
      byHandle: '@speedycodex'
    });

    const response = await run(GET, getEventFor(room.id));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0]).toMatchObject({
      memoryId: 'room.joint-answer-signoff-protocol.v1',
      title: 'room.joint-answer-signoff-protocol.v1',
      body: 'Presenter chosen, peer signs off, final cites evidence.',
      linkedRooms: [room.id],
      tags: ['key-value-memory'],
      source: 'key-value'
    });
  });

  it('includes configured memory-pack files linked to the room', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });
    writeFileSync(join(memoryPackDir, 'README.md'), `---
memory_id: README
created_at: 2026-05-28T10:00:00.000Z
linked_rooms: ['${room.id}']
tags: ['memory-pack']
---
# ANT memory pack

Read this before acting.
`, 'utf-8');
    mkdirSync(join(memoryPackDir, 'core'), { recursive: true });
    writeFileSync(join(memoryPackDir, 'core', 'mem_other.md'), `---
memory_id: mem_other
linked_rooms: ['other-room']
---
# Other room memory

This must not leak.
`, 'utf-8');

    const response = await run(GET, getEventFor(room.id));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0]).toMatchObject({
      memoryId: 'README',
      title: 'ANT memory pack',
      body: 'Read this before acting.',
      linkedRooms: [room.id],
      tags: ['memory-pack'],
      source: 'memory-pack',
      href: '/memory?q=README'
    });
  });

  it('includes universal configured memory-pack files even without linked_rooms', async () => {
    const room = createChatRoom({ name: 'memory room', whoCreatedIt: '@you' });
    writeFileSync(join(memoryPackDir, 'README.md'), `---
memory_id: README
created_at: 2026-05-28T10:00:00.000Z
default_room_policy: universal
tags: ['memory-pack']
---
# ANT memory pack

Read this before acting in any ANT room.
`, 'utf-8');
    mkdirSync(join(memoryPackDir, 'core'), { recursive: true });
    writeFileSync(join(memoryPackDir, 'core', 'mem_core.md'), `---
memory_id: mem_core
created_at: 2026-05-28T10:01:00.000Z
type: core
---
# Core ANT memory

This applies to every room.
`, 'utf-8');

    const response = await run(GET, getEventFor(room.id));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.memories.map((memory: { memoryId: string }) => memory.memoryId)).toEqual([
      'mem_core',
      'README'
    ]);
    expect(body.memories.every((memory: { source: string }) => memory.source === 'memory-pack')).toBe(true);
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
