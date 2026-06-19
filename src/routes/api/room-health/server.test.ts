import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests, archiveChatRoom } from '$lib/server/chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { createSession } from '$lib/server/antSessionStore';

// GET /api/room-health — read-only room-identity health feed (workstream C).
// Wraps listRoomHealth() + summary so the RoomHealthPanel can poll one cheap
// endpoint. Cross-room roster reads require aggregate auth.

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'room-health-admin-token';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-health-api-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
});

function insertTerminal(id: string, name: string): void {
  const db = getIdentityDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO terminals
       (id, pid, pid_start, name, source, meta, created_at, updated_at, status)
       VALUES (?, 1234, 'pstart', ?, 'test', '{}', ?, ?, 'live')`
  ).run(id, name, now, now);
}

function insertTerminalRecord(args: {
  sessionId: string;
  handle?: string | null;
  linkedChatRoomId?: string | null;
}): void {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO terminal_records
       (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms, handle, linked_chat_room_id)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
  ).run(args.sessionId, `record-${args.sessionId}`, now, now, args.handle ?? null, args.linkedChatRoomId ?? null);
}

function addMembershipRow(roomId: string, handle: string, terminalId: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
    )
    .run(`mem-${terminalId}`, roomId, handle, terminalId, Math.floor(Date.now() / 1000));
}

async function callGet(headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }): Promise<Response> {
  const url = new URL('http://localhost/api/room-health');
  const event = { request: new Request(url, { headers }), url } as unknown as Parameters<typeof GET>[0];
  return (await GET(event)) as Response;
}

async function callGetOrCaught(headers: HeadersInit = {}): Promise<Response> {
  try {
    return await callGet(headers);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('GET /api/room-health', () => {
  it('rejects anonymous cross-room health reads', async () => {
    const res = await callGetOrCaught({});
    expect(res.status).toBe(401);
  });

  it('returns an empty list + zeroed summary when no live terminals exist', async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminals).toEqual([]);
    expect(body.summary).toEqual({ total: 0, healthy: 0, broken: 0 });
  });

  it('returns terminals + summary with correct healthy/broken counts', async () => {
    const room = createChatRoom({ name: 'coord', whoCreatedIt: '@you' });
    // healthy
    insertTerminal('s1', 't1');
    insertTerminalRecord({ sessionId: 's1', handle: '@one', linkedChatRoomId: null });
    addMembershipRow(room.id, '@one', 's1');
    // broken — no membership
    insertTerminal('s2', 't2');
    insertTerminalRecord({ sessionId: 's2', handle: '@two', linkedChatRoomId: null });

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminals).toHaveLength(2);
    expect(body.summary).toEqual({ total: 2, healthy: 1, broken: 1 });

    const byId = Object.fromEntries(body.terminals.map((t: { terminalId: string }) => [t.terminalId, t]));
    expect(byId.s1.healthy).toBe(true);
    expect(byId.s1.brokenReason).toBeNull();
    expect(byId.s2.healthy).toBe(false);
    expect(byId.s2.brokenReason).toBe('no-membership');
  });

  it('surfaces a dangling linked room as broken', async () => {
    const room = createChatRoom({ name: 'to-archive', whoCreatedIt: '@you' });
    insertTerminal('s3', 't3');
    insertTerminalRecord({ sessionId: 's3', handle: '@three', linkedChatRoomId: room.id });
    addMembershipRow(room.id, '@three', 's3');
    archiveChatRoom(room.id);

    const res = await callGet();
    const body = await res.json();
    expect(body.summary.broken).toBe(1);
    expect(body.terminals[0].brokenReason).toBe('dangling-linked-room');
  });
});

describe('GET /api/room-health durableActivation field', () => {
  it("reports 'idle' with zeroed counts when there are no live terminals", async () => {
    const res = await callGet();
    const body = await res.json();
    expect(body.durableActivation.status).toBe('idle');
    expect(body.durableActivation.counts).toMatchObject({
      antSessions: 0,
      activeLeases: 0,
      liveTerminals: 0
    });
    expect(typeof body.durableActivation.reason).toBe('string');
  });

  it("reports 'dormant' when live terminals exist but ant_sessions is empty", async () => {
    insertTerminal('s1', 't1');
    insertTerminalRecord({ sessionId: 's1', handle: '@one', linkedChatRoomId: null });

    const res = await callGet();
    const body = await res.json();
    expect(body.durableActivation.status).toBe('dormant');
    expect(body.durableActivation.counts.liveTerminals).toBe(1);
    expect(body.durableActivation.counts.antSessions).toBe(0);
  });

  it("reports 'active' once durable sessions cover the live fleet", async () => {
    insertTerminal('s1', 't1');
    insertTerminalRecord({ sessionId: 's1', handle: '@one', linkedChatRoomId: null });
    createSession({ kind: 'local-cli', label: 's1' });

    const res = await callGet();
    const body = await res.json();
    expect(body.durableActivation.status).toBe('active');
    expect(body.durableActivation.counts.antSessions).toBe(1);
  });
});
