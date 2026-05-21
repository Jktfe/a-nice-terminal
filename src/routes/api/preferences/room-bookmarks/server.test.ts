import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'GET' | 'PUT', search = '', body?: unknown) {
  const url = new URL(`http://localhost/api/preferences/room-bookmarks${search}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return { request: new Request(url, init), url, params: {} };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('/api/preferences/room-bookmarks', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-bookmarks-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  it('returns an empty list before the operator stars a room', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('GET'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerHandle: '@you', roomIds: [] });
  });

  it('persists starred rooms in caller-supplied order', async () => {
    const first = createChatRoom({ name: 'first', whoCreatedIt: '@you' });
    const second = createChatRoom({ name: 'second', whoCreatedIt: '@you' });

    const putResponse = await run(PUT as unknown as AnyHandler, eventFor('PUT', '', { roomIds: [second.id, first.id] }));
    expect(putResponse.status).toBe(200);
    expect((await putResponse.json()).roomIds).toEqual([second.id, first.id]);

    const getResponse = await run(GET as unknown as AnyHandler, eventFor('GET'));
    expect((await getResponse.json()).roomIds).toEqual([second.id, first.id]);
  });

  it('rejects unknown room ids instead of storing stale bookmarks', async () => {
    const response = await run(PUT as unknown as AnyHandler, eventFor('PUT', '', { roomIds: ['missing-room'] }));
    expect(response.status).toBe(404);
  });
});
