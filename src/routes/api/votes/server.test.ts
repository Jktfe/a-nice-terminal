import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as votesGET, POST as votesPOST } from './+server';
import { GET as voteGET } from './[voteId]/+server';
import { POST as castPOST } from './[voteId]/cast/+server';
import { POST as closePOST } from './[voteId]/close/+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { listMessagesInRoom, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { mirrorAddMembership } from '$lib/server/v02ChatRoomBridge';
import { resetVoteStoreSchemaForTests } from '$lib/server/voteStore';

/**
 * Add a room membership the way the production join path does: write the
 * legacy `room_memberships` row (read by the identity gate's pidChain
 * resolver) AND mirror it into the v0.2 memberships store (read by
 * `isHandleMemberOfRoom` + `room.members`). The low-level
 * `roomMembershipsStore.addMembership` alone does NOT bridge to v0.2, so the
 * vote-create authorization check (`isHandleMemberOfRoom`) and the read gate's
 * `room.members` path would otherwise not see the member in tests.
 */
function seedMember(roomId: string, handle: string, terminalId: string) {
  addMembership({ room_id: roomId, handle, terminal_id: terminalId });
  mirrorAddMembership({ roomId, handle, displayName: handle, memberKind: 'agent' });
}

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-vote-routes-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetVoteStoreSchemaForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetVoteStoreSchemaForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

type Handler = (event: any) => unknown;
type Result = { status: number; body: Record<string, unknown> };

async function call(
  handler: Handler,
  opts: { method?: string; url: string; params?: Record<string, string>; body?: unknown; headers?: Record<string, string> }
): Promise<Result> {
  const init: RequestInit = { method: opts.method ?? 'GET' };
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  const url = new URL(`http://localhost${opts.url}`);
  const request = new Request(url, init);
  const event = { request, params: opts.params ?? {}, url };
  try {
    const response = (await handler(event)) as Response;
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { status: thrown.status, body: await thrown.json().catch(() => ({})) };
    }
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return { status: f.status, body: f.body ?? {} };
    throw thrown;
  }
}

function setupTwoRooms() {
  const primary = createChatRoom({ name: 'primary', whoCreatedIt: '@you' });
  const secondary = createChatRoom({ name: 'secondary', whoCreatedIt: '@you' });
  const chair = upsertTerminal({ pid: 7101, pid_start: 'convener', name: 'convener-terminal' });
  const a = upsertTerminal({ pid: 7102, pid_start: 'a', name: 'a-terminal' });
  const b = upsertTerminal({ pid: 7103, pid_start: 'b', name: 'b-terminal' });
  for (const room of [primary, secondary]) {
    seedMember(room.id, '@convener', chair.id);
    seedMember(room.id, '@a', a.id);
    seedMember(room.id, '@b', b.id);
  }
  return {
    primary,
    secondary,
    convenerPidChain: [{ pid: 7101, pid_start: 'convener' }],
    aPidChain: [{ pid: 7102, pid_start: 'a' }],
    bPidChain: [{ pid: 7103, pid_start: 'b' }]
  };
}

describe('votes API', () => {
  it('creates a cross-room vote and posts a receipt in every bound room', async () => {
    const { primary, secondary, convenerPidChain } = setupTwoRooms();
    const response = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        roomIds: [primary.id, secondary.id],
        title: 'Pick the route',
        options: ['A', 'B'],
        eligibleVoters: ['@a', '@b'],
        pidChain: convenerPidChain
      }
    });

    expect(response.status).toBe(201);
    const vote = response.body.vote as { id: string; roomIds: string[]; missingVoters: string[] };
    expect(vote.roomIds).toEqual([primary.id, secondary.id].sort());
    expect(vote.missingVoters).toEqual(['@a', '@b']);
    expect(listMessagesInRoom(primary.id).some((message) => message.body.includes(vote.id))).toBe(true);
    expect(listMessagesInRoom(secondary.id).some((message) => message.body.includes(vote.id))).toBe(true);
  });

  it('casts from a bound room as the server-resolved handle and completes the vote', async () => {
    const { primary, secondary, convenerPidChain, aPidChain, bPidChain } = setupTwoRooms();
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        roomIds: [primary.id, secondary.id],
        title: 'Ship?',
        options: ['yes', 'no'],
        eligibleVoters: ['@a', '@b'],
        pidChain: convenerPidChain
      }
    });
    const vote = created.body.vote as { id: string; options: Array<{ id: string; label: string }> };
    const yes = vote.options.find((option) => option.label === 'yes')!;
    const no = vote.options.find((option) => option.label === 'no')!;

    const first = await call(castPOST, {
      method: 'POST',
      url: `/api/votes/${vote.id}/cast`,
      params: { voteId: vote.id },
      body: { roomId: secondary.id, optionId: yes.id, reason: 'works', pidChain: aPidChain }
    });
    expect(first.status).toBe(200);
    expect((first.body.vote as { missingVoters: string[] }).missingVoters).toEqual(['@b']);

    const second = await call(castPOST, {
      method: 'POST',
      url: `/api/votes/${vote.id}/cast`,
      params: { voteId: vote.id },
      body: { roomId: primary.id, optionId: no.id, pidChain: bPidChain }
    });
    expect(second.status).toBe(200);
    expect((second.body.vote as { state: string }).state).toBe('complete');

    const pidQuery = `pidChain=${encodeURIComponent(JSON.stringify(convenerPidChain))}`;
    const listed = await call(votesGET, { url: `/api/votes?roomId=${primary.id}&${pidQuery}` });
    expect((listed.body.votes as Array<{ id: string }>).map((row) => row.id)).toEqual([vote.id]);

    const shown = await call(voteGET, {
      url: `/api/votes/${vote.id}?roomId=${primary.id}&${pidQuery}`,
      params: { voteId: vote.id }
    });
    expect((shown.body.vote as { complete: boolean }).complete).toBe(true);
  });

  it('closes an open vote and rejects further ballots', async () => {
    const { primary, convenerPidChain, aPidChain } = setupTwoRooms();
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        title: 'Close me',
        options: ['one', 'two'],
        eligibleVoters: ['@a'],
        pidChain: convenerPidChain
      }
    });
    const vote = created.body.vote as { id: string; options: Array<{ id: string }> };

    const closed = await call(closePOST, {
      method: 'POST',
      url: `/api/votes/${vote.id}/close`,
      params: { voteId: vote.id },
      body: { roomId: primary.id, pidChain: convenerPidChain }
    });
    expect(closed.status).toBe(200);
    expect((closed.body.vote as { state: string }).state).toBe('closed');

    const cast = await call(castPOST, {
      method: 'POST',
      url: `/api/votes/${vote.id}/cast`,
      params: { voteId: vote.id },
      body: { roomId: primary.id, optionId: vote.options[0].id, pidChain: aPidChain }
    });
    expect(cast.status).toBe(409);
  });
});

describe('votes API — authorization', () => {
  // Gap 1: create must authorize the creator in EVERY bound room.
  it('rejects create binding a room the creator is NOT a member of (403)', async () => {
    const { primary, convenerPidChain } = setupTwoRooms();
    // A third room the convener is NOT a member of.
    const outsider = createChatRoom({ name: 'outsider', whoCreatedIt: '@you' });
    const stranger = upsertTerminal({ pid: 7201, pid_start: 's', name: 'stranger-terminal' });
    addMembership({ room_id: outsider.id, handle: '@stranger', terminal_id: stranger.id });

    const response = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        roomIds: [primary.id, outsider.id],
        title: 'Bind a room I am not in',
        options: ['A', 'B'],
        eligibleVoters: ['@a', '@b'],
        pidChain: convenerPidChain
      }
    });
    expect(response.status).toBe(403);
  });

  // Gap 3 (list): listing requires room read access.
  it('rejects list without read access (no pidChain) — 401', async () => {
    const { primary } = setupTwoRooms();
    const listed = await call(votesGET, { url: `/api/votes?roomId=${primary.id}` });
    expect(listed.status).toBe(401);
  });

  it('rejects list by a non-member pidChain — unauthorized', async () => {
    const { primary } = setupTwoRooms();
    const outsiderRoom = createChatRoom({ name: 'outsider-list', whoCreatedIt: '@you' });
    const stranger = upsertTerminal({ pid: 7211, pid_start: 'sl', name: 'stranger-list-terminal' });
    seedMember(outsiderRoom.id, '@stranger', stranger.id);
    const strangerPid = encodeURIComponent(JSON.stringify([{ pid: 7211, pid_start: 'sl' }]));
    const listed = await call(votesGET, {
      url: `/api/votes?roomId=${primary.id}&pidChain=${strangerPid}`
    });
    // The stranger's pidChain resolves to no handle in `primary`, so the read
    // gate returns no access → 401 (vs 404 when a resolved handle simply
    // isn't a member). Either way the caller is denied the room's votes.
    expect([401, 404]).toContain(listed.status);
  });

  // Gap 3 (show): show requires roomId + read access + binding.
  it('rejects show without read access (no pidChain) — 401', async () => {
    const { primary, convenerPidChain } = setupTwoRooms();
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        title: 'Show me',
        options: ['x', 'y'],
        eligibleVoters: ['@a'],
        pidChain: convenerPidChain
      }
    });
    const voteId = (created.body.vote as { id: string }).id;
    const shown = await call(voteGET, {
      url: `/api/votes/${voteId}?roomId=${primary.id}`,
      params: { voteId }
    });
    expect(shown.status).toBe(401);
  });

  it('rejects show without roomId — 400', async () => {
    const { primary, convenerPidChain } = setupTwoRooms();
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        title: 'No room',
        options: ['x', 'y'],
        eligibleVoters: ['@a'],
        pidChain: convenerPidChain
      }
    });
    const voteId = (created.body.vote as { id: string }).id;
    const shown = await call(voteGET, {
      url: `/api/votes/${voteId}`,
      params: { voteId }
    });
    expect(shown.status).toBe(400);
  });

  it('rejects show against a room the vote is NOT bound to — 409', async () => {
    const { primary, secondary, convenerPidChain } = setupTwoRooms();
    // Vote bound to primary only.
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        title: 'Bound to primary only',
        options: ['x', 'y'],
        eligibleVoters: ['@a'],
        pidChain: convenerPidChain
      }
    });
    const voteId = (created.body.vote as { id: string }).id;
    const convPid = encodeURIComponent(JSON.stringify(convenerPidChain));
    const shown = await call(voteGET, {
      url: `/api/votes/${voteId}?roomId=${secondary.id}&pidChain=${convPid}`,
      params: { voteId }
    });
    expect(shown.status).toBe(409);
  });

  // Gap 2: close — only creator / chair / admin.
  function setupCloseScenario() {
    // Room owned by @convener (a real member terminal), with a separate creator
    // and a plain non-privileged member.
    const room = createChatRoom({ name: 'close-room', whoCreatedIt: '@convener' });
    const chair = upsertTerminal({ pid: 7301, pid_start: 'chairp', name: 'convener-chair-terminal' });
    const creator = upsertTerminal({ pid: 7302, pid_start: 'creator', name: 'creator-terminal' });
    const member = upsertTerminal({ pid: 7303, pid_start: 'member', name: 'member-terminal' });
    seedMember(room.id, '@convener', chair.id);
    seedMember(room.id, '@creator', creator.id);
    seedMember(room.id, '@member', member.id);
    const convenerChairPidChain = [{ pid: 7301, pid_start: 'chairp' }];
    const creatorPidChain = [{ pid: 7302, pid_start: 'creator' }];
    const memberPidChain = [{ pid: 7303, pid_start: 'member' }];
    return { room, convenerChairPidChain, creatorPidChain, memberPidChain };
  }

  async function openVoteAs(roomId: string, pidChain: unknown) {
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId,
        title: 'Close authz',
        options: ['one', 'two'],
        eligibleVoters: ['@member'],
        pidChain
      }
    });
    return (created.body.vote as { id: string }).id;
  }

  it('rejects close by a member who is NOT creator/chair/admin — 403', async () => {
    const { room, creatorPidChain, memberPidChain } = setupCloseScenario();
    const voteId = await openVoteAs(room.id, creatorPidChain);
    const closed = await call(closePOST, {
      method: 'POST',
      url: `/api/votes/${voteId}/close`,
      params: { voteId },
      body: { roomId: room.id, pidChain: memberPidChain }
    });
    expect(closed.status).toBe(403);
  });

  it('allows close by the vote creator — 200', async () => {
    const { room, creatorPidChain } = setupCloseScenario();
    const voteId = await openVoteAs(room.id, creatorPidChain);
    const closed = await call(closePOST, {
      method: 'POST',
      url: `/api/votes/${voteId}/close`,
      params: { voteId },
      body: { roomId: room.id, pidChain: creatorPidChain }
    });
    expect(closed.status).toBe(200);
    expect((closed.body.vote as { state: string; closedByHandle: string }).closedByHandle).toBe('@creator');
  });

  it('allows close by the room chair/owner (room.whoCreatedIt) — 200', async () => {
    const { room, creatorPidChain, convenerChairPidChain } = setupCloseScenario();
    const voteId = await openVoteAs(room.id, creatorPidChain);
    const closed = await call(closePOST, {
      method: 'POST',
      url: `/api/votes/${voteId}/close`,
      params: { voteId },
      body: { roomId: room.id, pidChain: convenerChairPidChain }
    });
    expect(closed.status).toBe(200);
    expect((closed.body.vote as { closedByHandle: string }).closedByHandle).toBe('@convener');
  });

  it('allows close by an admin (ANT_ADMIN_TOKEN bearer) — 200', async () => {
    const { room, creatorPidChain } = setupCloseScenario();
    const voteId = await openVoteAs(room.id, creatorPidChain);
    const previousAdmin = process.env.ANT_ADMIN_TOKEN;
    process.env.ANT_ADMIN_TOKEN = 'admin-token-for-vote-close';
    try {
      const closed = await call(closePOST, {
        method: 'POST',
        url: `/api/votes/${voteId}/close`,
        params: { voteId },
        body: { roomId: room.id },
        headers: { authorization: 'Bearer admin-token-for-vote-close' }
      });
      expect(closed.status).toBe(200);
      expect((closed.body.vote as { closedByHandle: string }).closedByHandle).toBe('@admin');
    } finally {
      if (previousAdmin === undefined) delete process.env.ANT_ADMIN_TOKEN;
      else process.env.ANT_ADMIN_TOKEN = previousAdmin;
    }
  });
});
