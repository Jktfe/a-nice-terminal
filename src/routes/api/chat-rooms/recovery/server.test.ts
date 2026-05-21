import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveChatRoom,
  createChatRoom,
  resetChatRoomStoreForTests,
  softDeleteChatRoom
} from '$lib/server/chatRoomStore';
import { GET } from './+server';

beforeEach(() => {
  resetChatRoomStoreForTests();
});

async function callGet(): Promise<Response> {
  const url = 'http://test.local/api/chat-rooms/recovery';
  const event = { request: new Request(url), url: new URL(url), params: {} } as Parameters<typeof GET>[0];
  return (await GET(event)) as Response;
}

describe('/api/chat-rooms/recovery', () => {
  it('lists archived rooms as restorable and soft-deleted rooms as boundary rows', async () => {
    const archived = createChatRoom({ name: 'archived room', whoCreatedIt: '@owner' });
    const deleted = createChatRoom({ name: 'deleted room', whoCreatedIt: '@owner' });
    const active = createChatRoom({ name: 'active room', whoCreatedIt: '@owner' });
    archiveChatRoom(archived.id, 10);
    softDeleteChatRoom(deleted.id, 20);

    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.archivedRooms.map((r: { id: string }) => r.id)).toEqual([archived.id]);
    expect(body.deletedRooms.map((r: { id: string }) => r.id)).toEqual([deleted.id]);
    expect(JSON.stringify(body)).not.toContain(active.id);
    expect(body.archivedRooms[0]).toMatchObject({ restorable: true, archivedAtMs: 10 });
    expect(body.deletedRooms[0]).toMatchObject({
      restorable: false,
      deleteBoundary: 'soft-deleted room restore is not implemented'
    });
  });
});
