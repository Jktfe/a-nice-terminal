import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
import { DELETE } from './[inviteId]/+server';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  createInvite,
  listActiveInvitesWithUsageForRoom,
  resetChatInviteStoreForTests
} from '$lib/server/chatInviteStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { getOperatorHandle } from '$lib/server/operatorHandle';

type InviteRouteEvent = Parameters<typeof POST>[0];
type RevokeRouteEvent = Parameters<typeof DELETE>[0];

type AnyHandler = (event: unknown) => unknown;

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;
const previousPublicOrigin = process.env.ANT_PUBLIC_ORIGIN;
const previousServerUrl = process.env.ANT_SERVER_URL;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-operator-invites-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'fresh.db');
  delete process.env.ANT_PUBLIC_ORIGIN;
  delete process.env.ANT_SERVER_URL;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatInviteStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDb;
  if (previousPublicOrigin === undefined) delete process.env.ANT_PUBLIC_ORIGIN;
  else process.env.ANT_PUBLIC_ORIGIN = previousPublicOrigin;
  if (previousServerUrl === undefined) delete process.env.ANT_SERVER_URL;
  else process.env.ANT_SERVER_URL = previousServerUrl;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatInviteStoreForTests();
});

function routeEvent(
  method: 'GET' | 'POST',
  roomId: string,
  opts: { cookie?: string; body?: unknown; url?: string } = {}
): InviteRouteEvent {
  const url = new URL(
    opts.url ?? `https://ant.example.test/api/chat-rooms/${encodeURIComponent(roomId)}/operator-invites`
  );
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return { request: new Request(url, init), params: { roomId }, url } as InviteRouteEvent;
}

function revokeEvent(
  roomId: string,
  inviteId: string,
  opts: { cookie?: string } = {}
): RevokeRouteEvent {
  const url = new URL(
    `https://ant.example.test/api/chat-rooms/${encodeURIComponent(roomId)}/operator-invites/${encodeURIComponent(inviteId)}`
  );
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  return {
    request: new Request(url, { method: 'DELETE', headers }),
    params: { roomId, inviteId },
    url
  } as RevokeRouteEvent;
}

async function run(handler: AnyHandler, event: InviteRouteEvent | RevokeRouteEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

function seedBrowserSession(roomId: string, handle: string): string {
  const db = getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const terminalId = `t_invites_${handle.replace(/[^a-zA-Z0-9]/g, '')}`;
  db.prepare(
    `INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, 0, 'test', ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(terminalId, `term-${handle}`, nowSec + 99_999, nowSec, nowSec);
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem-${terminalId}-${roomId}`, roomId, handle, terminalId, nowSec);
  const session = createBrowserSession({
    roomId,
    authorHandle: handle,
    browserSessionId: `bs_${terminalId}_${roomId}`
  });
  if (!session) throw new Error('Failed to create browser session');
  return `ant_browser_session=${session.browserSessionSecret}`;
}

describe('/api/chat-rooms/:roomId/operator-invites', () => {
  it('GET requires an operator browser session', async () => {
    const room = createChatRoom({ name: 'operator-invites-read', whoCreatedIt: getOperatorHandle() });

    const response = await run(GET as unknown as AnyHandler, routeEvent('GET', room.id));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Operator browser session required.'
    });
  });

  it('GET rejects a signed-in non-operator room member', async () => {
    const room = createChatRoom({ name: 'operator-invites-non-operator', whoCreatedIt: getOperatorHandle() });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@viewer' });
    const cookie = seedBrowserSession(room.id, '@viewer');

    const response = await run(GET as unknown as AnyHandler, routeEvent('GET', room.id, { cookie }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Only the operator can manage invites.'
    });
  });

  it('POST lets the operator create an invite and returns safe share strings', async () => {
    const room = createChatRoom({ name: 'operator-invites-create', whoCreatedIt: getOperatorHandle() });
    const cookie = seedBrowserSession(room.id, getOperatorHandle());

    const response = await run(POST as unknown as AnyHandler, routeEvent('POST', room.id, {
      cookie,
      body: {
        label: '  Remote Mark  ',
        password: 'share-code',
        kinds: ['cli', 'mcp', 'web']
      }
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.invite).toMatchObject({
      room_id: room.id,
      label: 'Remote Mark',
      kinds: ['cli', 'mcp', 'web'],
      created_by: getOperatorHandle()
    });
    expect(payload.invite.share.cli).toBe(`ant://ant.example.test/r/${room.id}?invite=${payload.invite.id}`);
    expect(payload.invite.share.mcp).toBe(`https://ant.example.test/mcp/room/${room.id}?invite=${payload.invite.id}`);
    expect(payload.invite.share.web).toBe(`https://ant.example.test/r/${payload.invite.id}`);
    expect(JSON.stringify(payload)).not.toContain('password');
    expect(JSON.stringify(payload)).not.toContain('tokenSecret');
  });

  it('GET lists active invites newest-first with usage metadata', async () => {
    const room = createChatRoom({ name: 'operator-invites-list', whoCreatedIt: getOperatorHandle() });
    const cookie = seedBrowserSession(room.id, getOperatorHandle());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T08:00:00.000Z'));
    const first = createInvite({
      roomId: room.id,
      label: 'First',
      password: 'first-pass',
      kinds: ['cli'],
      createdBy: getOperatorHandle()
    });
    vi.setSystemTime(new Date('2026-06-19T08:01:00.000Z'));
    const second = createInvite({
      roomId: room.id,
      label: 'Second',
      password: 'second-pass',
      kinds: ['web'],
      createdBy: getOperatorHandle()
    });

    const response = await run(GET as unknown as AnyHandler, routeEvent('GET', room.id, { cookie }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.invites.map((invite: { id: string }) => invite.id)).toEqual([second.id, first.id]);
    expect(payload.invites[0]).toMatchObject({
      id: second.id,
      label: 'Second',
      redeemed_count: 0,
      active_token_count: 0,
      last_redeemed_at: null,
      last_seen_at: null,
      share: {
        web: `https://ant.example.test/r/${second.id}`
      }
    });
    expect(JSON.stringify(payload)).not.toContain('password');
    expect(JSON.stringify(payload)).not.toContain('tokenSecret');
  });

  it('POST rejects invalid invite bodies before writing', async () => {
    const room = createChatRoom({ name: 'operator-invites-invalid', whoCreatedIt: getOperatorHandle() });
    const cookie = seedBrowserSession(room.id, getOperatorHandle());

    const response = await run(POST as unknown as AnyHandler, routeEvent('POST', room.id, {
      cookie,
      body: { label: 'x', password: 'abc', kinds: ['cli'] }
    }));

    expect(response.status).toBe(400);
    expect(listActiveInvitesWithUsageForRoom(room.id)).toEqual([]);
  });
});

describe('/api/chat-rooms/:roomId/operator-invites/:inviteId', () => {
  it('DELETE requires an operator browser session and leaves the invite active', async () => {
    const room = createChatRoom({ name: 'operator-invites-delete-auth', whoCreatedIt: getOperatorHandle() });
    const invite = createInvite({
      roomId: room.id,
      label: 'Do not revoke',
      password: 'safe-pass',
      kinds: ['cli'],
      createdBy: getOperatorHandle()
    });

    const response = await run(DELETE as unknown as AnyHandler, revokeEvent(room.id, invite.id));

    expect(response.status).toBe(403);
    expect(listActiveInvitesWithUsageForRoom(room.id).map((row) => row.id)).toEqual([invite.id]);
  });

  it('DELETE lets the operator revoke an invite idempotently', async () => {
    const room = createChatRoom({ name: 'operator-invites-delete', whoCreatedIt: getOperatorHandle() });
    const cookie = seedBrowserSession(room.id, getOperatorHandle());
    const invite = createInvite({
      roomId: room.id,
      label: 'Revoke me',
      password: 'safe-pass',
      kinds: ['cli'],
      createdBy: getOperatorHandle()
    });

    const first = await run(DELETE as unknown as AnyHandler, revokeEvent(room.id, invite.id, { cookie }));
    const second = await run(DELETE as unknown as AnyHandler, revokeEvent(room.id, invite.id, { cookie }));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(listActiveInvitesWithUsageForRoom(room.id)).toEqual([]);
  });
});
