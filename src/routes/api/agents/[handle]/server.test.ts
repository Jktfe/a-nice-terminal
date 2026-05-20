import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { GET, PATCH } from './+server';

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

function getReq(handle: string): Parameters<typeof GET>[0] {
  return {
    params: { handle }
  } as Parameters<typeof GET>[0];
}

function patchReq(handle: string, body: unknown): Parameters<typeof PATCH>[0] {
  return {
    params: { handle },
    request: new Request('http://x/api/agents/' + encodeURIComponent(handle), {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  } as Parameters<typeof PATCH>[0];
}

describe('GET /api/agents/:handle', () => {
  it('returns agent details with room memberships', async () => {
    const room = createChatRoom({ name: 'agent-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });

    const res = await GET(getReq('@alpha'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agent).toMatchObject({
      handle: '@alpha',
      displayName: 'Alpha',
      rooms: [expect.objectContaining({ roomId: room.id, roomName: 'agent-room' })]
    });
  });

  it('404s unknown agents', async () => {
    await expect(GET(getReq('@ghost'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('PATCH /api/agents/:handle', () => {
  it('updates display metadata for an agent across all rooms', async () => {
    const first = createChatRoom({ name: 'first-room', whoCreatedIt: '@you' });
    const second = createChatRoom({ name: 'second-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: first.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });
    inviteAgentToRoom({ roomId: second.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });

    const res = await PATCH(
      patchReq('@alpha', {
        displayName: 'Alpha Prime',
        displayColor: '#123456',
        displayIcon: 'robot',
        displayBackgroundStyle: 'solid'
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agent).toMatchObject({
      handle: '@alpha',
      displayName: 'Alpha Prime',
      displayColor: '#123456',
      displayIcon: 'robot',
      displayBackgroundStyle: 'solid',
      rooms: expect.arrayContaining([
        expect.objectContaining({ roomId: first.id }),
        expect.objectContaining({ roomId: second.id })
      ])
    });
  });

  it('rejects patches with no valid display fields', async () => {
    createChatRoom({ name: 'agent-room', whoCreatedIt: '@you' });

    await expect(PATCH(patchReq('@alpha', { ignored: true }))).rejects.toMatchObject({
      status: 400
    });
  });
});
