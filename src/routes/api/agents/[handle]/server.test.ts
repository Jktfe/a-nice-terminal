import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { GET, PATCH } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'agent-detail-route-test-admin';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function getReq(handle: string, authenticated = true): Parameters<typeof GET>[0] {
  const headers = authenticated ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    params: { handle },
    request: new Request('http://x/api/agents/' + encodeURIComponent(handle), { headers })
  } as Parameters<typeof GET>[0];
}

function patchReq(handle: string, body: unknown, authenticated = true): Parameters<typeof PATCH>[0] {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    params: { handle },
    request: new Request('http://x/api/agents/' + encodeURIComponent(handle), {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    })
  } as Parameters<typeof PATCH>[0];
}

describe('GET /api/agents/:handle', () => {
  it('401s anonymous agent detail reads', async () => {
    const room = createChatRoom({ name: 'agent-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });

    await expect(GET(getReq('@alpha', false))).rejects.toMatchObject({ status: 401 });
  });

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
  it('401s anonymous metadata writes before mutation', async () => {
    const room = createChatRoom({ name: 'agent-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@alpha', agentDisplayName: 'Alpha' });

    await expect(PATCH(patchReq('@alpha', { displayName: 'Nope' }, false))).rejects.toMatchObject({
      status: 401
    });
    const res = await GET(getReq('@alpha'));
    const body = await res.json();
    expect(body.agent.displayName).toBe('Alpha');
  });

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
