import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { POST } from './+server';
import { archiveChatRoom, createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';

const PREV_USERS_PATH = process.env.ANTCHAT_DEV_USERS_PATH;
const PREV_LICENCES_PATH = process.env.ANTCHAT_DEV_LICENCES_PATH;
const PREV_BROWSER_LOGIN_ROOM_ID = process.env.ANT_BROWSER_LOGIN_ROOM_ID;
const PREV_DEMO_ROOM_ID = process.env.ANT_DEMO_ROOM_ID;

let tmpDir: string;
let activeRoomId: string;

function resetIdentityRows(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM browser_sessions').run();
  db.prepare('DELETE FROM room_memberships').run();
  db.prepare('DELETE FROM terminals').run();
  resetChatRoomStoreForTests();
}

function writeAuthFiles(): void {
  const usersPath = join(tmpDir, 'dev-users.json');
  const licencesPath = join(tmpDir, 'dev-licences.json');
  writeFileSync(
    usersPath,
    JSON.stringify({
      users: [
        {
          email: 'demo-operator-m5@example.test',
          role: 'dev',
          handle: '@jamesm5',
          password_hash: bcrypt.hashSync('test-demo-pass', 12),
          must_change_password: false
        }
      ]
    }),
    'utf8'
  );
  writeFileSync(
    licencesPath,
    JSON.stringify({
      allowedEmails: ['demo-operator-m5@example.test'],
      tier: 'dev',
      features: ['all']
    }),
    'utf8'
  );
  process.env.ANTCHAT_DEV_USERS_PATH = usersPath;
  process.env.ANTCHAT_DEV_LICENCES_PATH = licencesPath;
}

function createRoomWithId(id: string): void {
  const db = getIdentityDb();
  const nextOrderRow = db
    .prepare('SELECT COALESCE(MAX(creation_order), 0) + 1 AS next FROM chat_rooms')
    .get() as { next: number };
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_rooms
      (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `room ${id}`, 'fixture room', 'ready', 'just now', nowIso, '@jamesm5', nextOrderRow.next);
  db.prepare(
    `INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), id, '@jamesm5', '@jamesm5', '#2563EB', 'J', 'transparent', nowIso, 'human');
}

function eventForPost(body: unknown) {
  return {
    request: new Request('http://localhost/api/auth/demo-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/auth/demo-login'),
    params: {}
  } as never;
}

async function capture(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'antchat-browser-login-'));
  resetIdentityRows();
  writeAuthFiles();
  const room = createChatRoom({ name: 'm5 test room', whoCreatedIt: '@jamesm5' });
  activeRoomId = room.id;
  process.env.ANT_DEMO_ROOM_ID = room.id;
  delete process.env.ANT_BROWSER_LOGIN_ROOM_ID;
});

afterEach(() => {
  resetIdentityRows();
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_USERS_PATH === undefined) delete process.env.ANTCHAT_DEV_USERS_PATH;
  else process.env.ANTCHAT_DEV_USERS_PATH = PREV_USERS_PATH;
  if (PREV_LICENCES_PATH === undefined) delete process.env.ANTCHAT_DEV_LICENCES_PATH;
  else process.env.ANTCHAT_DEV_LICENCES_PATH = PREV_LICENCES_PATH;
  if (PREV_BROWSER_LOGIN_ROOM_ID === undefined) delete process.env.ANT_BROWSER_LOGIN_ROOM_ID;
  else process.env.ANT_BROWSER_LOGIN_ROOM_ID = PREV_BROWSER_LOGIN_ROOM_ID;
  if (PREV_DEMO_ROOM_ID === undefined) delete process.env.ANT_DEMO_ROOM_ID;
  else process.env.ANT_DEMO_ROOM_ID = PREV_DEMO_ROOM_ID;
});

describe('POST /api/auth/demo-login browser cookie login', () => {
  it('accepts a dev-user password and mints a browser cookie for that handle', async () => {
    const response = await capture(() =>
      POST(
        eventForPost({
          email: 'demo-operator-m5@example.test',
          password: 'test-demo-pass'
        })
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('ant_browser_session=bws_');
    const body = await response.json();
    expect(body.handle).toBe('@jamesm5');
    expect(body.email).toBe('demo-operator-m5@example.test');
  });

  it('uses the current valid browser-login room when no env override is set', async () => {
    delete process.env.ANT_BROWSER_LOGIN_ROOM_ID;
    delete process.env.ANT_DEMO_ROOM_ID;
    createRoomWithId('fnokx03pud');

    const response = await capture(() =>
      POST(
        eventForPost({
          email: 'demo-operator-m5@example.test',
          password: 'test-demo-pass'
        })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.roomId).toBe('fnokx03pud');
  });

  it('falls back to an active room when the configured login room is archived', async () => {
    const archived = createChatRoom({ name: 'archived login room', whoCreatedIt: '@jamesm5' });
    archiveChatRoom(archived.id);
    process.env.ANT_DEMO_ROOM_ID = archived.id;

    const response = await capture(() =>
      POST(
        eventForPost({
          email: 'demo-operator-m5@example.test',
          password: 'test-demo-pass'
        })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.roomId).toBe(activeRoomId);
  });

  it('rejects a dev-user wrong password', async () => {
    const response = await capture(() =>
      POST(
        eventForPost({
          email: 'demo-operator-m5@example.test',
          password: 'wrong'
        })
      )
    );

    expect(response.status).toBe(401);
  });
});
