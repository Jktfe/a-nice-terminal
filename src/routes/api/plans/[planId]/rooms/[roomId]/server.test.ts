import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  _resetPlanRoomLinksForTests,
  attachPlanToRoom,
  listRoomsForPlan
} from '$lib/server/planRoomLinkStore';
import { DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'plan-room-admin-token';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  _resetPlanRoomLinksForTests();
});

afterEach(() => {
  _resetPlanRoomLinksForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function delReq(
  planId: string,
  roomId: string,
  token: string | null = ADMIN_TOKEN
): Parameters<typeof DELETE>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    params: { planId, roomId },
    request: new Request(
      'http://x/api/plans/' +
        encodeURIComponent(planId) +
        '/rooms/' +
        encodeURIComponent(roomId),
      { method: 'DELETE', headers }
    )
  } as Parameters<typeof DELETE>[0];
}

describe('DELETE /api/plans/:planId/rooms/:roomId', () => {
  it('requires an authenticated caller (cookie, antchat Bearer, or admin bearer)', async () => {
    // Lane D mirror of POST sibling: cookie-or-admin contract. Admin token
    // unset + no cookie returns 401 (no identity) rather than 503 (env not
    // configured), because the cookie path is now an equally-valid lane.
    const room = createChatRoom({ name: 'linked room', whoCreatedIt: '@tester' });

    await expect(DELETE(delReq('plan-a', room.id, null))).rejects.toMatchObject({ status: 401 });
    await expect(DELETE(delReq('plan-a', room.id, 'wrong'))).rejects.toMatchObject({
      status: 401
    });
    delete process.env.ANT_ADMIN_TOKEN;
    await expect(DELETE(delReq('plan-a', room.id))).rejects.toMatchObject({ status: 401 });
  });

  it('detaches links idempotently and validates route params', async () => {
    const room = createChatRoom({ name: 'linked room', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-a', roomId: room.id });

    const first = await DELETE(delReq('plan-a', room.id));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ removed: true });
    expect(listRoomsForPlan('plan-a')).toEqual([]);

    const second = await DELETE(delReq('plan-a', room.id));
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ removed: false });

    await expect(DELETE(delReq('', room.id))).rejects.toMatchObject({ status: 400 });
    await expect(DELETE(delReq('plan-a', ''))).rejects.toMatchObject({ status: 400 });
  });
});
