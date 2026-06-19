/**
 * /api/terminals/[id]/chatrooms endpoint tests.
 *
 * Covers:
 *   - 404 for unknown terminal id
 *   - empty list when terminal has no memberships
 *   - single + multiple memberships with role='member'
 *   - role='chair' when chat_rooms.current_chair_handle matches the
 *     terminal's per-room handle
 *   - terminal's intrinsic linked chat is excluded
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-chatrooms-test-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(path: string, params: Record<string, string>, withAuth = true): unknown {
  const url = new URL(`http://localhost${path}`);
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  const request = new Request(url.toString(), { headers });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function makeTerminal(name: string, pid: number) {
  return upsertTerminal({ pid, pid_start: `start-${pid}`, name });
}

async function callGet(terminalId: string, withAuth = true): Promise<Response> {
  return runHandler(
    GET as unknown as AnyHandler,
    eventFor(`/api/terminals/${terminalId}/chatrooms`, { id: terminalId }, withAuth)
  );
}

describe('/api/terminals/[id]/chatrooms', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminal-chatrooms-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('rejects anonymous reads before exposing terminal room memberships', async () => {
    const terminal = makeTerminal('private-memberships', 9299);
    const response = await callGet(terminal.id, false);
    expect(response.status).toBe(401);
  });

  it('returns 404 when the terminal id does not exist', async () => {
    const response = await callGet('does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns an empty list when the terminal has no memberships', async () => {
    const terminal = makeTerminal('lonely', 9301);
    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.chatRooms).toEqual([]);
  });

  it('lists rooms the terminal is a member of with role=member', async () => {
    const terminal = makeTerminal('joiner', 9302);
    const roomA = createChatRoom({ name: 'roomA', whoCreatedIt: '@owner' });
    const roomB = createChatRoom({ name: 'roomB', whoCreatedIt: '@owner' });
    addMembership({ room_id: roomA.id, handle: '@joiner', terminal_id: terminal.id });
    addMembership({ room_id: roomB.id, handle: '@joiner', terminal_id: terminal.id });

    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    const sortedById = [...payload.chatRooms].sort(
      (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)
    );
    const expected = [
      { id: roomA.id, name: 'roomA', role: 'member' },
      { id: roomB.id, name: 'roomB', role: 'member' }
    ].sort((left, right) => left.id.localeCompare(right.id));
    expect(sortedById).toEqual(expected);
  });

  it('marks the terminal as chair when its per-room handle matches current_chair_handle', async () => {
    const terminal = makeTerminal('chairy', 9303);
    const room = createChatRoom({ name: 'chair-room', whoCreatedIt: '@founder' });
    addMembership({ room_id: room.id, handle: '@chairy', terminal_id: terminal.id });
    getIdentityDb()
      .prepare(`UPDATE chat_rooms SET current_chair_handle = ? WHERE id = ?`)
      .run('@chairy', room.id);

    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.chatRooms).toEqual([
      { id: room.id, name: 'chair-room', role: 'chair' }
    ]);
  });

  it('excludes the terminals own linked chat from the result', async () => {
    const terminal = makeTerminal('linkedup', 9304);
    const ordinary = createChatRoom({ name: 'ordinary', whoCreatedIt: '@owner' });
    const linked = createChatRoom({ name: 'linked-chat', whoCreatedIt: '@owner' });
    addMembership({ room_id: ordinary.id, handle: '@linkedup', terminal_id: terminal.id });
    addMembership({ room_id: linked.id, handle: '@linkedup', terminal_id: terminal.id });
    // Mark `linked` as the terminal's intrinsic linked chat via terminal_records.
    createTerminalRecord({
      sessionId: terminal.id,
      name: terminal.name,
      linkedChatRoomId: linked.id
    });

    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.chatRooms.map((r: { id: string }) => r.id)).toEqual([ordinary.id]);
  });
});
