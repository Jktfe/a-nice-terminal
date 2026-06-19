import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { type TerminalRow, upsertTerminal } from '$lib/server/terminalsStore';
import { writeInput } from '$lib/server/ptyClient';
import { POST } from './+server';

vi.mock('$lib/server/ptyClient', () => ({
  writeInput: vi.fn()
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-input';

type AnyHandler = (event: unknown) => unknown;

let nextPid = 41_000;

function seedTerminal(input: {
  createdBy?: string | null;
  allowlist?: string[] | null;
  meta?: Record<string, unknown>;
  name?: string;
} = {}): TerminalRow {
  nextPid += 1;
  const terminal = upsertTerminal({
    pid: nextPid,
    pid_start: `terminal-input-test-${nextPid}`,
    name: input.name ?? `terminal-input-${nextPid}`,
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
  const room = createChatRoom({ name: `terminal-input-auth-${nextPid}`, whoCreatedIt: '@JWPK' });
  const terminal = upsertTerminal({
    pid: nextPid,
    pid_start: `browser-session-${nextPid}`,
    name: `browser-member-${nextPid}`
  });
  addMembership({ room_id: room.id, handle, terminal_id: terminal.id });
  const session = createBrowserSession({ roomId: room.id, authorHandle: handle });
  if (!session) throw new Error(`failed to create browser session for ${handle}`);
  return `ant_browser_session=${session.browserSessionSecret}`;
}

function eventFor(id: string, body?: unknown, opts?: { auth?: boolean; cookie?: string }) {
  const url = new URL(`http://localhost/api/terminals/${id}/input`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.cookie) headers.cookie = opts.cookie;
  else if (opts?.auth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {})
    }),
    url,
    params: { id }
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
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

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
});

afterAll(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  vi.mocked(writeInput).mockClear();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/:id/input', () => {
  it('POST 202 writes input for admin bearer on an existing terminal', async () => {
    const terminal = seedTerminal();

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'hello' }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, 'hello');
  });

  it('POST 404 keeps admin bearer from writing unknown terminal ids', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('missing-terminal', { data: 'hello' }));

    expect(res.status).toBe(404);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('POST 202 writes input for the terminal owner browser session', async () => {
    const terminal = seedTerminal({ createdBy: '@owner' });
    const cookie = browserCookieFor('@owner');

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'owner' }, { cookie }));

    expect(res.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, 'owner');
  });

  it('POST 202 writes input for a terminal co-owner browser session', async () => {
    const terminal = seedTerminal({ createdBy: '@owner', allowlist: ['@coowner'] });
    const cookie = browserCookieFor('@coowner');

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'coowner' }, { cookie }));

    expect(res.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, 'coowner');
  });

  it('POST 202 writes input for an explicit read_write grant', async () => {
    const terminal = seedTerminal({
      createdBy: '@owner',
      meta: { writeGrants: [{ handle: '@writer', mode: 'read_write' }] }
    });
    const cookie = browserCookieFor('@writer');

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'grant' }, { cookie }));

    expect(res.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, 'grant');
  });

  it('POST 202 treats legacy timestamp-only write grants as read_write', async () => {
    const terminal = seedTerminal({
      createdBy: '@owner',
      meta: { writeGrants: [{ handle: '@legacy-writer', grantedAtMs: 123 }] }
    });
    const cookie = browserCookieFor('@legacy-writer');

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'legacy' }, { cookie }));

    expect(res.status).toBe(202);
    expect(vi.mocked(writeInput)).toHaveBeenCalledWith(terminal.id, 'legacy');
  });

  it('POST 403 rejects a read-only grant before writing', async () => {
    const terminal = seedTerminal({
      createdBy: '@owner',
      meta: { writeGrants: [{ handle: '@reader', mode: 'read' }] }
    });
    const cookie = browserCookieFor('@reader');

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'nope' }, { cookie }));

    expect(res.status).toBe(403);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('POST 403 rejects an unrelated browser session before writing', async () => {
    const terminal = seedTerminal({ createdBy: '@owner' });
    const cookie = browserCookieFor('@stranger');

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'nope' }, { cookie }));

    expect(res.status).toBe(403);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('POST 400 on empty id', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('', { data: 'hello' }));
    expect(res.status).toBe(400);
  });

  it('POST 400 when data is missing', async () => {
    const terminal = seedTerminal();

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, {}));

    expect(res.status).toBe(400);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('POST 400 when data is not a string', async () => {
    const terminal = seedTerminal();

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 123 }));

    expect(res.status).toBe(400);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });

  it('POST 401 when no auth is supplied (CVE FIX A 2026-05-19)', async () => {
    const terminal = seedTerminal();

    const res = await run(POST as unknown as AnyHandler, eventFor(terminal.id, { data: 'hello' }, { auth: false }));

    expect(res.status).toBe(401);
    expect(vi.mocked(writeInput)).not.toHaveBeenCalled();
  });
});
