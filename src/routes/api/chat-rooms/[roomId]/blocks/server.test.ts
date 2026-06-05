/**
 * Endpoint tests for the blocks API (list / read / tombstone). Auth via
 * admin-bearer (the simplest path through resolveChatRoomReadAccess /
 * requireChatRoomMutationAuth). The store itself is covered by
 * roomBlocksStore.test.ts; these assert the HTTP wiring: auth gating, the
 * admin-only includeDeleted view, the open-block delete refusal, and 404s.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as listGET } from './+server';
import { GET as readGET, POST as tombstonePOST } from './[blockId]/+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { postMessage, postBreakMessage } from '$lib/server/chatMessageStore';
import { OPEN_BLOCK_ID } from '$lib/server/roomBlocksStore';

const ADMIN_TOKEN = 'blocks-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-blocks-ep-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
  if (prevVault === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = prevVault;
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function authHeaders(withAuth = true): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) h.authorization = `Bearer ${ADMIN_TOKEN}`;
  return h;
}

async function asResponse(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

function event(roomId: string, blockId: string | null, opts: { withAuth?: boolean; method?: string; body?: string; query?: string } = {}) {
  const path = `http://localhost/api/chat-rooms/${roomId}/blocks${blockId ? `/${blockId}` : ''}${opts.query ?? ''}`;
  const request = new Request(path, { method: opts.method ?? 'GET', headers: authHeaders(opts.withAuth ?? true), body: opts.body });
  return { request, params: { roomId, blockId: blockId ?? '' }, url: new URL(path) } as never;
}

/** room with one sealed block (break1) + an open block. */
function seed() {
  const room = createChatRoom({ name: 'ep', whoCreatedIt: '@you' });
  postMessage({ roomId: room.id, authorHandle: '@a', body: 'm0', kind: 'agent' });
  const b1 = postBreakMessage({ roomId: room.id, reason: 'seal', postedByHandle: '@you' });
  postMessage({ roomId: room.id, authorHandle: '@a', body: 'm1-open', kind: 'agent' });
  return { roomId: room.id, break1: b1.id };
}

describe('blocks API endpoints', () => {
  it('GET /blocks lists blocks (200) and 401s without auth, 404s unknown room', async () => {
    const { roomId } = seed();
    const ok = await asResponse(() => listGET(event(roomId, null)));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.blocks).toHaveLength(2); // sealed + open
    expect((await asResponse(() => listGET(event(roomId, null, { withAuth: false })))).status).toBe(401);
    expect((await asResponse(() => listGET(event('nope', null)))).status).toBe(404);
  });

  it('GET /blocks/:id reads a section (200) and 404s an unknown block', async () => {
    const { roomId, break1 } = seed();
    const res = await asResponse(() => readGET(event(roomId, break1)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages.map((m: { body: string }) => m.body)).toEqual(['m0']);
    expect((await asResponse(() => readGET(event(roomId, 'no-such')))).status).toBe(404);
  });

  it('POST /blocks/:id tombstones a sealed block; refuses the open block (400)', async () => {
    const { roomId, break1 } = seed();
    const del = await asResponse(() => tombstonePOST(event(roomId, break1, { method: 'POST', body: JSON.stringify({ deleted: true }) })));
    expect(del.status).toBe(200);

    // tombstoned → normal read is now empty
    const afterDelete = await asResponse(() => readGET(event(roomId, break1)));
    expect((await afterDelete.json()).messages).toEqual([]);
    // admin audit view (includeDeleted=1) still surfaces it
    const audit = await asResponse(() => readGET(event(roomId, break1, { query: '?includeDeleted=1' })));
    expect((await audit.json()).messages.map((m: { body: string }) => m.body)).toEqual(['m0']);

    // the open block can't be deleted
    const openDel = await asResponse(() => tombstonePOST(event(roomId, OPEN_BLOCK_ID, { method: 'POST', body: JSON.stringify({ deleted: true }) })));
    expect(openDel.status).toBe(400);
    // bad body → 400
    const bad = await asResponse(() => tombstonePOST(event(roomId, break1, { method: 'POST', body: JSON.stringify({}) })));
    expect(bad.status).toBe(400);
  });
});
