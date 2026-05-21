/**
 * Server tests for GET /api/me/mentions.
 *
 * Coverage:
 *   - Immediate return when matching messages already exist.
 *   - Timeout return when no matches and wait > 0.
 *   - bindings.json filter (only listed handles count).
 *   - bindings.json missing → falls back to caller handle.
 *   - Unauthenticated callers get 401.
 *   - Long-poll wakes on a live broadcast.
 *
 * Auth is driven via the admin Bearer fallback path (the operator path
 * the MCP server uses) so tests don't have to mint browser cookies.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage } from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_ACCOUNT_DIR = process.env.ANT_ACCOUNT_DIR;

const ADMIN_TOKEN = 'mentions-route-test-token';

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-mentions-'));
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.ANT_ACCOUNT_DIR = join(scratchDir, 'account');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  try {
    rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  if (PREV_ACCOUNT_DIR === undefined) delete process.env.ANT_ACCOUNT_DIR;
  else process.env.ANT_ACCOUNT_DIR = PREV_ACCOUNT_DIR;
});

function getEvent(qs = '', token: string | null = ADMIN_TOKEN): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    url: new URL(`http://x/api/me/mentions${qs}`),
    request: new Request(`http://x/api/me/mentions${qs}`, { headers })
  } as Parameters<typeof GET>[0];
}

async function call(qs = '', token: string | null = ADMIN_TOKEN): Promise<Response> {
  try {
    return (await GET(getEvent(qs, token))) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    // SvelteKit's `error(status, message)` throws an HttpError shape
    // instead of a Response — convert it for assertion convenience.
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function writeBindingsFile(handles: string[]): void {
  const accountDir = join(scratchDir, 'account', 'acct_test', 'devices', 'dev_test');
  mkdirSync(accountDir, { recursive: true });
  const payload = {
    deviceId: 'dev_test',
    accountId: 'acct_test',
    bindings: handles.map((h) => ({ handle: h, target: 'james@example.com' })),
    updatedAtMs: Date.now()
  };
  writeFileSync(join(accountDir, 'bindings.json'), JSON.stringify(payload), 'utf8');
}

describe('GET /api/me/mentions', () => {
  it('401s without any auth', async () => {
    const res = await call('?since=0&wait=0', null);
    expect(res.status).toBe(401);
  });

  it('returns immediately when matching messages already exist', async () => {
    const room = createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@other', body: 'hello @you please look' });

    const res = await call('?since=0&wait=0');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.mentions)).toBe(true);
    expect(data.mentions).toHaveLength(1);
    expect(data.mentions[0]).toMatchObject({
      roomId: room.id,
      roomName: 'Room A',
      authorHandle: '@other',
      body: 'hello @you please look',
      matchedHandle: '@you'
    });
    expect(typeof data.nextCursor).toBe('number');
    expect(data.nextCursor).toBeGreaterThan(0);
  });

  it('returns empty when wait=0 and no matches exist', async () => {
    createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    const res = await call('?since=0&wait=0');
    const data = await res.json();
    expect(data.mentions).toEqual([]);
    expect(data.nextCursor).toBe(0);
  });

  it('returns empty after wait timeout when no matches arrive', async () => {
    createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    // wait=1 second is enough to prove the timeout path without dragging
    // CI. The handler clamps; nothing further needed.
    const start = Date.now();
    const res = await call('?since=0&wait=1');
    const elapsed = Date.now() - start;
    const data = await res.json();
    expect(data.mentions).toEqual([]);
    expect(data.nextCursor).toBe(0);
    // Loose lower bound to confirm we actually blocked rather than
    // returning instantly. Tightening this risks CI flakes; ~800ms is
    // a comfortable floor below the 1000ms timeout.
    expect(elapsed).toBeGreaterThanOrEqual(800);
  });

  it('honours bindings.json — only listed handles match', async () => {
    writeBindingsFile(['@bound-handle']);
    const room = createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@other', body: 'hi @you not you' });
    postMessage({ roomId: room.id, authorHandle: '@other', body: 'hi @bound-handle yes you' });

    const res = await call('?since=0&wait=0');
    const data = await res.json();
    // Only the second message matched — first mentions @you, which is
    // the caller's resolved handle but is NOT in bindings.json.
    expect(data.mentions).toHaveLength(1);
    expect(data.mentions[0].body).toBe('hi @bound-handle yes you');
    expect(data.mentions[0].matchedHandle).toBe('@bound-handle');
  });

  it('falls back to caller handle when bindings.json is missing', async () => {
    // No bindings.json written — ANT_ACCOUNT_DIR points at an empty tmpdir.
    const room = createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@other', body: '@you ping' });

    const res = await call('?since=0&wait=0');
    const data = await res.json();
    expect(data.mentions).toHaveLength(1);
    expect(data.mentions[0].matchedHandle).toBe('@you');
  });

  it('respects the since cursor — older messages are filtered out', async () => {
    const room = createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@other', body: '@you first' });
    // Advance the cursor past the first message.
    const firstRes = await (await call('?since=0&wait=0')).json();
    const cursorAfterFirst = firstRes.nextCursor as number;
    expect(firstRes.mentions).toHaveLength(1);

    // Ensure the second message's posted_at is strictly greater than
    // the first's — chat_messages.posted_at is millisecond precision,
    // so back-to-back postMessage() calls in fast tests can collide
    // on the same millisecond. A short wait keeps the cursor semantic
    // honest without adding API complexity.
    await new Promise((resolve) => setTimeout(resolve, 5));
    postMessage({ roomId: room.id, authorHandle: '@other', body: '@you second' });
    const secondRes = await (await call(`?since=${cursorAfterFirst}&wait=0`)).json();
    expect(secondRes.mentions).toHaveLength(1);
    expect(secondRes.mentions[0].body).toBe('@you second');
  });

  it('wakes on a live broadcast within the wait window', async () => {
    const room = createChatRoom({ name: 'Room A', whoCreatedIt: '@you' });
    // Fire the long-poll, then post + broadcast a matching message
    // ~50ms later. The route should return immediately, well before the
    // 3-second wait expires.
    const pending = call('?since=0&wait=3');
    setTimeout(() => {
      const msg = postMessage({ roomId: room.id, authorHandle: '@bot', body: '@you wake up' });
      broadcastToRoom(room.id, { type: 'message_added', message: msg });
    }, 50);
    const start = Date.now();
    const res = await pending;
    const elapsed = Date.now() - start;
    const data = await res.json();
    expect(data.mentions).toHaveLength(1);
    expect(data.mentions[0].matchedHandle).toBe('@you');
    expect(elapsed).toBeLessThan(2000);
  });
});
