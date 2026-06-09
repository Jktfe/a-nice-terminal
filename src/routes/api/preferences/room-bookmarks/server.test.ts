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
    expect(await response.json()).toEqual({ ownerHandle: '@JWPK', roomIds: [] });
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

  it('SKIPS unknown room ids and persists the valid ones (no all-or-nothing 404)', async () => {
    // JWPK 2026-06-09 "stars aren't persisting": one stale/since-deleted room in
    // the star set must NOT kill the whole save. Unknown ids are dropped; valid
    // ones persist (the client fires-and-forgets, so a 404 was a silent total loss).
    const real = createChatRoom({ name: 'real', whoCreatedIt: '@you' });
    const response = await run(
      PUT as unknown as AnyHandler,
      eventFor('PUT', '', { roomIds: [real.id, 'missing-room'] })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).roomIds).toEqual([real.id]); // stale dropped, valid kept

    const getResponse = await run(GET as unknown as AnyHandler, eventFor('GET'));
    expect((await getResponse.json()).roomIds).toEqual([real.id]); // persisted
  });

  it('a save containing ONLY unknown rooms persists an empty set (still 200, not 404)', async () => {
    const response = await run(PUT as unknown as AnyHandler, eventFor('PUT', '', { roomIds: ['missing-room'] }));
    expect(response.status).toBe(200);
    expect((await response.json()).roomIds).toEqual([]);
  });
});
