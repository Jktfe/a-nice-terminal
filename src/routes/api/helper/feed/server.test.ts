import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '$lib/server/db';
import { GET } from './+server';
import { mintLease, revokeLease } from '$lib/server/helperLeaseStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { addMember } from '$lib/server/membershipStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-helper-feed-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
});

type TestEvent = { request: Request; params: Record<string, string>; url: URL };

function ev(query: string, secret?: string): TestEvent {
  const url = new URL(`http://localhost/api/helper/feed${query}`);
  const headers: Record<string, string> = {};
  if (secret) headers['x-ant-attachment'] = secret;
  return { request: new Request(url.toString(), { headers }), params: {}, url };
}

async function call(event: TestEvent): Promise<Response> {
  try {
    return (await (GET as unknown as (e: TestEvent) => Promise<Response>)(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number };
    if (typeof f?.status === 'number') return new Response(null, { status: f.status });
    throw thrown;
  }
}

function seedRoomWithMember(handle: string) {
  const room = createChatRoom({ name: `feed-${handle}-${Math.floor(Math.random() * 1e6)}`, whoCreatedIt: '@JWPK' });
  addMember(room.id, handle, `sess-${handle}`);
  return room;
}

describe('GET /api/helper/feed — lease-gated, metadata only (the doorbell law)', () => {
  it('401s without a live attachment; revoked attachment is deaf', async () => {
    expect((await call(ev('?since=0'))).status).toBe(401);
    const { leaseId, secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    revokeLease(leaseId);
    expect((await call(ev('?since=0', secret))).status).toBe(401);
  });

  it('returns NEW message metadata for the handle\'s rooms — never bodies, own posts excluded', async () => {
    const room = seedRoomWithMember('@fClaude');
    const { secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    postMessage({ roomId: room.id, authorHandle: '@JWPK', body: 'hello @fClaude, secret plans inside' });
    postMessage({ roomId: room.id, authorHandle: '@fClaude', body: 'my own post' });
    postMessage({ roomId: room.id, authorHandle: '@speedy', body: 'unrelated chatter' });

    const res = await call(ev('?since=0', secret));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2); // own post excluded
    const senders = body.events.map((e: { senderHandle: string }) => e.senderHandle).sort();
    expect(senders).toEqual(['@JWPK', '@speedy']);
    // doorbell law: metadata only — the body NEVER crosses
    expect(JSON.stringify(body)).not.toContain('secret plans');
    expect(JSON.stringify(body)).not.toContain('chatter');
    const mention = body.events.find((e: { senderHandle: string }) => e.senderHandle === '@JWPK');
    expect(mention.mentionsYou).toBe(true);
    expect(mention.roomId).toBe(room.id);
    expect(typeof mention.postOrder).toBe('number');
    expect(body.cursor).toBeGreaterThan(0);
  });

  it('cursor advances: a second call with the returned cursor yields nothing new', async () => {
    const room = seedRoomWithMember('@fClaude');
    const { secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    postMessage({ roomId: room.id, authorHandle: '@JWPK', body: 'first' });
    const first = await (await call(ev('?since=0', secret))).json();
    const second = await (await call(ev(`?since=${first.cursor}`, secret), )).json();
    expect(second.events).toHaveLength(0);
    expect(second.cursor).toBe(first.cursor);
  });

  it('does not leak rooms the handle is NOT a member of', async () => {
    const otherRoom = seedRoomWithMember('@someoneElse');
    postMessage({ roomId: otherRoom.id, authorHandle: '@JWPK', body: 'not for you' });
    const { secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    const res = await call(ev('?since=0', secret));
    const body = await res.json();
    expect(body.events).toHaveLength(0);
  });
});
