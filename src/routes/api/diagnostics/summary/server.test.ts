import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { GET } from './+server';

const PREV_DB = process.env.ANT_FRESH_DB_PATH;
const PREV_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'summary-admin-token';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB;
  if (PREV_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_TOKEN;
});

describe('GET /api/diagnostics/summary', () => {
  it('returns public safe diagnostics without leaking admin secrets', async () => {
    const room = createChatRoom({ name: 'summary-room', whoCreatedIt: '@test' });

    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.pid).toBe(process.pid);
    expect(body.nodeVersion).toMatch(/^v/);
    expect(body.db).toMatchObject({
      reachable: true,
      path: ':memory:',
      mainBytes: expect.any(Number),
      mainSize: expect.any(String)
    });
    expect(body.sse).toMatchObject({
      totalSubscribers: 0,
      rooms: expect.arrayContaining([
        expect.objectContaining({ roomId: room.id, roomName: 'summary-room', count: 0 })
      ])
    });
    expect(body.cliHookLag).toMatchObject({
      latestSec: -1,
      p50Sec: -1,
      p99Sec: -1,
      sampleCount: 0
    });
    expect(body.sampledAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(ADMIN_TOKEN);
  });
});
