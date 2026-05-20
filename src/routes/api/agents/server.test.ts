import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

function req(url: string): Parameters<typeof GET>[0] {
  return {
    url: new URL(url)
  } as Parameters<typeof GET>[0];
}

describe('GET /api/agents', () => {
  it('lists global agents deduplicated by handle with room memberships', async () => {
    const first = createChatRoom({ name: 'room-one', whoCreatedIt: '@you' });
    const second = createChatRoom({ name: 'room-two', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: second.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@beta', agentDisplayName: 'Beta' });

    const res = await GET(req('http://x/api/agents'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agents.map((agent: { handle: string }) => agent.handle)).toEqual(['@alpha', '@beta']);
    const alpha = body.agents.find((agent: { handle: string }) => agent.handle === '@alpha');
    expect(alpha).toMatchObject({
      handle: '@alpha',
      displayName: 'Alpha',
      rooms: expect.arrayContaining([
        expect.objectContaining({ roomId: first.id, roomName: 'room-one' }),
        expect.objectContaining({ roomId: second.id, roomName: 'room-two' })
      ])
    });
  });

  it('filters agents by roomId and rejects missing rooms', async () => {
    const first = createChatRoom({ name: 'room-one', whoCreatedIt: '@you' });
    const second = createChatRoom({ name: 'room-two', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: second.id, agentHandle: '@beta', agentDisplayName: 'Beta' });

    const res = await GET(req(`http://x/api/agents?roomId=${first.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([
      expect.objectContaining({
        handle: '@alpha',
        rooms: [expect.objectContaining({ roomId: first.id })]
      })
    ]);

    await expect(GET(req('http://x/api/agents?roomId=missing-room'))).rejects.toMatchObject({
      status: 404
    });
  });
});
