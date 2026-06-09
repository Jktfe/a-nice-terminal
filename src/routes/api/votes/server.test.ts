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
import { resetVoteStoreSchemaForTests } from '$lib/server/voteStore';

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
  opts: { method?: string; url: string; params?: Record<string, string>; body?: unknown }
): Promise<Result> {
  const init: RequestInit = { method: opts.method ?? 'GET' };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
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
    addMembership({ room_id: room.id, handle: '@convener', terminal_id: chair.id });
    addMembership({ room_id: room.id, handle: '@a', terminal_id: a.id });
    addMembership({ room_id: room.id, handle: '@b', terminal_id: b.id });
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

    const listed = await call(votesGET, { url: `/api/votes?roomId=${primary.id}` });
    expect((listed.body.votes as Array<{ id: string }>).map((row) => row.id)).toEqual([vote.id]);

    const shown = await call(voteGET, {
      url: `/api/votes/${vote.id}`,
      params: { voteId: vote.id }
    });
    expect((shown.body.vote as { complete: boolean }).complete).toBe(true);
  });

  it('posts cast receipts with selected option and changed-from audit detail', async () => {
    const { primary, convenerPidChain, aPidChain } = setupTwoRooms();
    const created = await call(votesPOST, {
      method: 'POST',
      url: '/api/votes',
      body: {
        roomId: primary.id,
        title: 'Which route?',
        options: ['left', 'right'],
        eligibleVoters: ['@a'],
        pidChain: convenerPidChain
      }
    });
    const vote = created.body.vote as { id: string; options: Array<{ id: string; label: string }> };
    const left = vote.options.find((option) => option.label === 'left')!;
    const right = vote.options.find((option) => option.label === 'right')!;

    const first = await call(castPOST, {
      method: 'POST',
      url: `/api/votes/${vote.id}/cast`,
      params: { voteId: vote.id },
      body: { roomId: primary.id, optionId: left.id, pidChain: aPidChain }
    });
    expect(first.status).toBe(200);

    const second = await call(castPOST, {
      method: 'POST',
      url: `/api/votes/${vote.id}/cast`,
      params: { voteId: vote.id },
      body: { roomId: primary.id, optionId: right.id, pidChain: aPidChain }
    });
    expect(second.status).toBe(200);

    const receipts = listMessagesInRoom(primary.id)
      .map((message) => message.body)
      .filter((body) => body.includes(`voteID=${vote.id}`));
    expect(receipts.join('\n')).toContain('choice=left');
    expect(receipts.join('\n')).toContain('choice=right changedFrom=left');
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
