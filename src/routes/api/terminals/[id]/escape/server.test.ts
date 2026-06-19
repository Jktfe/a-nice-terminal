import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ptyClient', () => ({
  writeInput: vi.fn()
}));

import { writeInput } from '$lib/server/ptyClient';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { type TerminalRow, upsertTerminal } from '$lib/server/terminalsStore';
import { POST } from './+server';

type AnyHandler = (event: unknown) => unknown;

const TEST_ADMIN_TOKEN = 'test-admin-token-escape';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
let nextPid = 51_000;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
});

afterAll(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function seedTerminal(input: {
  createdBy?: string | null;
  allowlist?: string[] | null;
  meta?: Record<string, unknown>;
  name?: string;
} = {}): TerminalRow {
  nextPid += 1;
  const terminal = upsertTerminal({
    pid: nextPid,
    pid_start: `terminal-escape-test-${nextPid}`,
    name: input.name ?? `terminal-escape-${nextPid}`,
    meta: input.meta
  });
  createTerminalRecord({
    sessionId: terminal.id,
    name: terminal.name,
    createdBy: input.createdBy ?? null,
    allowlist: input.allowlist ?? null
  });
  return terminal;
}

function browserCookieFor(handle: string): string {
  nextPid += 1;
  const room = createChatRoom({ name: `terminal-escape-auth-${nextPid}`, whoCreatedIt: '@JWPK' });
  const terminal = upsertTerminal({
    pid: nextPid,
    pid_start: `browser-session-${nextPid}`,
    name: `browser-member-escape-${nextPid}`
  });
  addMembership({ room_id: room.id, handle, terminal_id: terminal.id });
  const session = createBrowserSession({ roomId: room.id, authorHandle: handle });
  if (!session) throw new Error(`failed to create browser session for ${handle}`);
  return `ant_browser_session=${session.browserSessionSecret}`;
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

function eventFor(sessionId: string, opts?: { auth?: boolean; cookie?: string }): unknown {
  const url = new URL(`http://localhost/api/terminals/${sessionId}/escape`);
  const headers: Record<string, string> = {};
  if (opts?.cookie) headers.cookie = opts.cookie;
  else if (opts?.auth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    request: new Request(url, { method: 'POST', headers }),
    params: { id: sessionId },
    url
  };
}

describe('POST /api/terminals/:id/escape', () => {
  beforeEach(() => {
    process.env.ANT_FRESH_DB_PATH = ':memory:';
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    vi.mocked(writeInput).mockClear();
  });

  afterAll(() => {
    resetChatRoomStoreForTests();
    resetIdentityDbForTests();
    if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  });

  it('sends exactly one ESC byte to the PTY and returns 202', async () => {
    const terminal = seedTerminal({ name: 't_interrupt' });

    const response = await runHandler(POST as unknown as AnyHandler, eventFor(terminal.id));

    expect(response.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, '\x1b');
    expect(await response.json()).toEqual({ ok: true, sessionId: terminal.id, sent: 'escape' });
  });

  it('returns 202 for an explicit read_write grant', async () => {
    const terminal = seedTerminal({
      createdBy: '@owner',
      meta: { writeGrants: [{ handle: '@writer', mode: 'read_write' }] }
    });
    const cookie = browserCookieFor('@writer');

    const response = await runHandler(POST as unknown as AnyHandler, eventFor(terminal.id, { cookie }));

    expect(response.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, '\x1b');
  });

  it('rejects an unrelated browser session before sending ESC', async () => {
    const terminal = seedTerminal({ createdBy: '@owner' });
    const cookie = browserCookieFor('@stranger');

    const response = await runHandler(POST as unknown as AnyHandler, eventFor(terminal.id, { cookie }));

    expect(response.status).toBe(403);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('rejects unknown terminal ids before sending ESC', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, eventFor('missing-terminal'));

    expect(response.status).toBe(404);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('rejects a blank session id', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, eventFor(''));

    expect(response.status).toBe(400);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('returns 401 when no auth is supplied (CVE FIX A 2026-05-19)', async () => {
    const response = await runHandler(POST as unknown as AnyHandler, eventFor('t_interrupt', { auth: false }));

    expect(response.status).toBe(401);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });
});
