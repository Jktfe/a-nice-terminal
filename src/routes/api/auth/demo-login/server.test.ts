import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb } from '$lib/server/db';

const PREV_USERS_PATH = process.env.ANTCHAT_DEV_USERS_PATH;
const PREV_LICENCES_PATH = process.env.ANTCHAT_DEV_LICENCES_PATH;
const PREV_DEMO_ROOM_ID = process.env.ANT_DEMO_ROOM_ID;
const PREV_DEMO_EMAIL = process.env.ANT_DEMO_EMAIL;
const PREV_DEMO_PASSWORD = process.env.ANT_DEMO_PASSWORD;
const PREV_DEMO_HANDLE = process.env.ANT_DEMO_HANDLE;

let tmpDir: string;

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
          email: 'redacted@example.com',
          role: 'dev',
          handle: '@jamesm5',
          password_hash: bcrypt.hashSync('REDACTED-ROTATED-CRED', 12),
          must_change_password: false
        }
      ]
    }),
    'utf8'
  );
  writeFileSync(
    licencesPath,
    JSON.stringify({
      allowedEmails: ['redacted@example.com'],
      tier: 'dev',
      features: ['all']
    }),
    'utf8'
  );
  process.env.ANTCHAT_DEV_USERS_PATH = usersPath;
  process.env.ANTCHAT_DEV_LICENCES_PATH = licencesPath;
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
  delete process.env.ANT_DEMO_EMAIL;
  delete process.env.ANT_DEMO_PASSWORD;
  delete process.env.ANT_DEMO_HANDLE;
  const room = createChatRoom({ name: 'm5 test room', whoCreatedIt: '@jamesm5' });
  process.env.ANT_DEMO_ROOM_ID = room.id;
});

afterEach(() => {
  resetIdentityRows();
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_USERS_PATH === undefined) delete process.env.ANTCHAT_DEV_USERS_PATH;
  else process.env.ANTCHAT_DEV_USERS_PATH = PREV_USERS_PATH;
  if (PREV_LICENCES_PATH === undefined) delete process.env.ANTCHAT_DEV_LICENCES_PATH;
  else process.env.ANTCHAT_DEV_LICENCES_PATH = PREV_LICENCES_PATH;
  if (PREV_DEMO_ROOM_ID === undefined) delete process.env.ANT_DEMO_ROOM_ID;
  else process.env.ANT_DEMO_ROOM_ID = PREV_DEMO_ROOM_ID;
  if (PREV_DEMO_EMAIL === undefined) delete process.env.ANT_DEMO_EMAIL;
  else process.env.ANT_DEMO_EMAIL = PREV_DEMO_EMAIL;
  if (PREV_DEMO_PASSWORD === undefined) delete process.env.ANT_DEMO_PASSWORD;
  else process.env.ANT_DEMO_PASSWORD = PREV_DEMO_PASSWORD;
  if (PREV_DEMO_HANDLE === undefined) delete process.env.ANT_DEMO_HANDLE;
  else process.env.ANT_DEMO_HANDLE = PREV_DEMO_HANDLE;
});

describe('POST /api/auth/demo-login browser cookie login', () => {
  it('accepts a dev-user password and mints a browser cookie for that handle', async () => {
    const response = await capture(() =>
      POST(
        eventForPost({
          email: 'redacted@example.com',
          password: 'REDACTED-ROTATED-CRED'
        })
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('ant_browser_session=bws_');
    const body = await response.json();
    expect(body.handle).toBe('@jamesm5');
    expect(body.email).toBe('redacted@example.com');
  });

  it('rejects a dev-user wrong password', async () => {
    const response = await capture(() =>
      POST(
        eventForPost({
          email: 'redacted@example.com',
          password: 'wrong'
        })
      )
    );

    expect(response.status).toBe(401);
  });
});
