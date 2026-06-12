import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks for the store seams the endpoint imports.
const h = vi.hoisted(() => ({
  lease: null as null | { id: string; handle: string },
  rooms: [] as string[],
  msg: null as null | Record<string, unknown>
}));

vi.mock('$lib/server/helperLeaseStore', () => ({
  resolveLeaseBySecret: (s: string) => (s === 'good' ? h.lease : null),
  touchLease: () => {}
}));
vi.mock('$lib/server/membershipStore', () => ({
  listRoomsForHandle: () => h.rooms
}));
vi.mock('$lib/server/db', () => ({
  getIdentityDb: () => ({ prepare: () => ({ get: () => h.msg }) })
}));

import { GET } from './+server';

function call(messageId: string, scope: string, secret = 'good') {
  const url = new URL(`http://x/api/helper/message/${messageId}?scope=${scope}`);
  return GET({
    params: { messageId },
    url,
    request: new Request(url, { headers: { 'x-ant-attachment': secret } })
  } as never);
}

describe('COURIER body endpoint', () => {
  beforeEach(() => {
    h.lease = { id: 'lease_1', handle: '@bee' };
    h.rooms = ['room_1'];
    h.msg = { id: 'm1', room_id: 'room_1', author_handle: '@ant', author_display_name: 'Ant',
              body: 'hi @bee', post_order: 5, posted_at: 1 };
  });

  it('401 without a live lease', async () => {
    await expect(call('m1', 'direct', 'bad')).rejects.toMatchObject({ status: 401 });
  });

  it('returns the body for a direct mention at scope=direct', async () => {
    const res = await call('m1', 'direct');
    expect((await res.json()).body).toBe('hi @bee');
  });

  it('withholds the body (204) when message is out of scope', async () => {
    h.msg = { ...h.msg!, body: 'just chatting, no tags' };
    const res = await call('m1', 'direct');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('everyone scope admits a bare @everyone broadcast', async () => {
    h.msg = { ...h.msg!, body: 'heads up @everyone' };
    expect((await call('m1', 'everyone')).status).toBe(200);
    expect((await call('m1', 'direct')).status).toBe(204);
  });

  it('untagged scope admits any in-room message', async () => {
    h.msg = { ...h.msg!, body: 'no tags here' };
    expect((await call('m1', 'untagged')).status).toBe(200);
  });

  it('does NOT over-match: @bee is not mentioned by @beekeeper (no substring leak)', async () => {
    h.msg = { ...h.msg!, body: 'ping @beekeeper about the hive' };
    expect((await call('m1', 'direct')).status).toBe(204);
    expect((await call('m1', 'everyone')).status).toBe(204);
    // but a real token mention of @bee is admitted
    h.msg = { ...h.msg!, body: 'thanks @bee!' };
    expect((await call('m1', 'direct')).status).toBe(200);
  });

  it('404 when the handle is not a member of the room', async () => {
    h.rooms = ['other_room'];
    await expect(call('m1', 'untagged')).rejects.toMatchObject({ status: 404 });
  });

  it('404 for the handle’s own post (never couriered back)', async () => {
    h.msg = { ...h.msg!, author_handle: '@bee' };
    await expect(call('m1', 'untagged')).rejects.toMatchObject({ status: 404 });
  });

  it('404 when missing/deleted (db returns nothing)', async () => {
    h.msg = null;
    await expect(call('m1', 'untagged')).rejects.toMatchObject({ status: 404 });
  });
});
