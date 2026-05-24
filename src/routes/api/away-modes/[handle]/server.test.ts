import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT, DELETE } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';

const ADMIN_TOKEN = 'test-admin-token-away-modes';

type AnyHandler = (event: unknown) => unknown;

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;
const previousAdmin = process.env.ANT_ADMIN_TOKEN;

function eventFor(
  handle: string,
  method: 'GET' | 'PUT' | 'DELETE',
  opts: { cookie?: string; bearer?: string; body?: unknown } = {}
) {
  const url = new URL(`http://localhost/api/away-modes/${encodeURIComponent(handle)}`);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return { request: new Request(url, init), url, params: { handle } };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') {
      return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    }
    throw thrown;
  }
}

async function makeSessionFor(handle: string): Promise<string> {
  const room = createChatRoom({ name: `test-room-${handle}`, whoCreatedIt: handle });
  const db = (await import('$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, 0, 'test', ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(`t_${handle}`, `term-${handle}`, nowSec + 99999, nowSec, nowSec);
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem-${handle}`, room.id, handle, `t_${handle}`, nowSec);
  const result = createBrowserSession({ roomId: room.id, authorHandle: handle, browserSessionId: `bs_${handle}` });
  if (!result) throw new Error(`Failed to create browser session for ${handle}`);
  return result.browserSessionSecret;
}

describe('GET/PUT/DELETE /api/away-modes/:handle auth', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-away-mode-test-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'fresh.db');
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDb;
    if (previousAdmin === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdmin;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
  });

  it('401s when neither admin bearer nor browser-session cookie is present', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('@you', 'GET'));
    expect(res.status).toBe(401);
  });

  it('admin bearer can GET/PUT any handle', async () => {
    const putRes = await run(PUT as unknown as AnyHandler, eventFor('@anyone', 'PUT', {
      bearer: ADMIN_TOKEN,
      body: { tier: 'away-desk' }
    }));
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.mode.tier).toBe('away-desk');
    expect(putBody.mode.setBy).toBe('@admin');

    const getRes = await run(GET as unknown as AnyHandler, eventFor('@anyone', 'GET', { bearer: ADMIN_TOKEN }));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).mode.tier).toBe('away-desk');
  });

  it('browser-session cookie can set its OWN handle', async () => {
    const secret = await makeSessionFor('@you');
    const res = await run(PUT as unknown as AnyHandler, eventFor('@you', 'PUT', {
      cookie: `ant_browser_session=${secret}`,
      body: { tier: 'away-office' }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode.tier).toBe('away-office');
    expect(body.mode.setBy).toBe('@you');
  });

  it('browser-session cookie CANNOT set someone else\'s handle', async () => {
    const secret = await makeSessionFor('@you');
    const res = await run(PUT as unknown as AnyHandler, eventFor('@codex', 'PUT', {
      cookie: `ant_browser_session=${secret}`,
      body: { tier: 'away-desk' }
    }));
    expect(res.status).toBe(401);
  });

  it('browser-session cookie can DELETE its OWN handle', async () => {
    const secret = await makeSessionFor('@you');
    // First set so there's something to delete.
    await run(PUT as unknown as AnyHandler, eventFor('@you', 'PUT', {
      cookie: `ant_browser_session=${secret}`,
      body: { tier: 'away-desk' }
    }));
    const res = await run(DELETE as unknown as AnyHandler, eventFor('@you', 'DELETE', {
      cookie: `ant_browser_session=${secret}`
    }));
    expect(res.status).toBe(200);
  });

  it('PUT rejects invalid tier', async () => {
    const res = await run(PUT as unknown as AnyHandler, eventFor('@you', 'PUT', {
      bearer: ADMIN_TOKEN,
      body: { tier: 'eep' }
    }));
    expect(res.status).toBe(400);
  });
});
