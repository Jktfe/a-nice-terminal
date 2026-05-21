import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  _resetPlanRoomLinksForTests,
  attachPlanToRoom
} from '$lib/server/planRoomLinkStore';
import { GET, POST } from './+server';

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

function getReq(planId: string): Parameters<typeof GET>[0] {
  return {
    params: { planId }
  } as Parameters<typeof GET>[0];
}

function postReq(
  planId: string,
  body: unknown,
  token: string | null = ADMIN_TOKEN
): Parameters<typeof POST>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    params: { planId },
    request: new Request('http://x/api/plans/' + encodeURIComponent(planId) + '/rooms', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

describe('GET /api/plans/:planId/rooms', () => {
  it('lists rooms attached to the plan and rejects missing plan ids', async () => {
    const alpha = createChatRoom({ name: 'alpha', whoCreatedIt: '@tester' });
    const beta = createChatRoom({ name: 'beta', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-a', roomId: alpha.id, attachedBy: '@codex' });
    attachPlanToRoom({ planId: 'plan-a', roomId: beta.id });
    attachPlanToRoom({ planId: 'other-plan', roomId: alpha.id });

    const res = await GET(getReq('plan-a'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rooms.map((room: { roomId: string }) => room.roomId)).toEqual([alpha.id, beta.id]);
    expect(body.rooms[0]).toMatchObject({
      roomId: alpha.id,
      name: 'alpha',
      attachedBy: '@codex'
    });
    expect(body.rooms[1]).toMatchObject({
      roomId: beta.id,
      name: 'beta',
      attachedBy: null
    });
    await expect(GET(getReq(''))).rejects.toMatchObject({ status: 400 });
  });
});

describe('POST /api/plans/:planId/rooms', () => {
  it('requires an authenticated caller (cookie, antchat Bearer, or admin bearer)', async () => {
    // Lane D (JWPK msg_hcwpvjwfg8 ratify, 2026-05-19): the user-facing
    // attach flow accepts a browser-session cookie OR admin-bearer. With
    // neither present the route 401s; with only a wrong admin token it
    // still 401s (admin path rejected, no cookie to fall through to).
    const room = createChatRoom({ name: 'linked room', whoCreatedIt: '@tester' });

    await expect(POST(postReq('plan-a', { roomId: room.id }, null))).rejects.toMatchObject({
      status: 401
    });
    await expect(POST(postReq('plan-a', { roomId: room.id }, 'wrong'))).rejects.toMatchObject({
      status: 401
    });
    delete process.env.ANT_ADMIN_TOKEN;
    await expect(POST(postReq('plan-a', { roomId: room.id }))).rejects.toMatchObject({
      status: 401
    });
  });

  it('attaches rooms idempotently and validates body/room state', async () => {
    const room = createChatRoom({ name: 'linked room', whoCreatedIt: '@tester' });

    const first = await POST(postReq('plan-a', { roomId: room.id, attachedBy: '@codex' }));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ attached: true, alreadyAttached: false });

    const second = await POST(postReq('plan-a', { roomId: room.id }));
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ attached: false, alreadyAttached: true });

    await expect(POST(postReq('', { roomId: room.id }))).rejects.toMatchObject({ status: 400 });
    await expect(POST(postReq('plan-a', null))).rejects.toMatchObject({ status: 400 });
    await expect(POST(postReq('plan-a', { roomId: '   ' }))).rejects.toMatchObject({
      status: 400
    });
    await expect(POST(postReq('plan-a', { roomId: 'missing-room' }))).rejects.toMatchObject({
      status: 404
    });
  });

  it('Lane D: cookie identity authenticates POST (no admin bearer needed)', async () => {
    // JWPK msg_hcwpvjwfg8 + msg_xyrlvisazp (2026-05-19): the user-facing
    // attach flow uses an ant_browser_session cookie minted by /login or
    // any room visit. No admin-bearer needed; attribution is the
    // server-resolved handle (cannot be forged via body.attachedBy).
    const room = createChatRoom({ name: 'linked room', whoCreatedIt: '@tester' });
    const { addMembership } = await import('$lib/server/roomMembershipsStore');
    const { upsertTerminal } = await import('$lib/server/terminalsStore');
    const terminal = upsertTerminal({ pid: 4242, pid_start: 'cookie-attach', name: 'cookie' });
    addMembership({ room_id: room.id, handle: '@you', terminal_id: terminal.id });
    const { createBrowserSession } = await import('$lib/server/browserSessionStore');
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@you' });
    if (!session) throw new Error('expected browser session');

    const req = {
      params: { planId: 'plan-a' },
      request: new Request('http://x/api/plans/plan-a/rooms', {
        method: 'POST',
        headers: { cookie: `ant_browser_session=${session.browserSessionSecret}` },
        body: JSON.stringify({ roomId: room.id, attachedBy: '@spoof-attempt' })
      })
    } as Parameters<typeof POST>[0];
    const response = await POST(req);
    expect(response.status).toBe(200);

    const { listRoomsForPlan } = await import('$lib/server/planRoomLinkStore');
    const attached = listRoomsForPlan('plan-a');
    expect(attached).toHaveLength(1);
    // attachedBy is the server-resolved handle, not the client-supplied spoof.
    expect(attached[0].attachedBy).toBe('@you');
  });
});
