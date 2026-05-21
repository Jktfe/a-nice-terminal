import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { _resetPlanRoomLinksForTests } from '$lib/server/planRoomLinkStore';
import { getPlan, _resetPlanStoreForTests } from '$lib/server/planStore';
import { _resetTaskStoreForTests } from '$lib/server/taskStore';

function event(roomId: string) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/plans`);
  return { params: { roomId }, url, request: new Request(url) } as unknown as Parameters<typeof GET>[0];
}

describe('/api/chat-rooms/:roomId/plans', () => {
  beforeEach(() => {
    _resetPlanRoomLinksForTests();
    _resetTaskStoreForTests();
    _resetPlanStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('returns no plans when the room has no explicit plan links', async () => {
    const room = createChatRoom({ name: 'discussion: ui', whoCreatedIt: '@you' });
    const response = await GET(event(room.id));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.plans).toEqual([]);
    expect(getPlan(`room-${room.id}`)).toBeNull();
  });
});
