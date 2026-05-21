import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTerminalRecord } from '\$lib/server/terminalRecordsStore';
import { createChatRoom, resetChatRoomStoreForTests } from '\$lib/server/chatRoomStore';
import { POST } from './+server';

vi.mock('\$lib/server/chatMessageStore', () => ({
  postMessage: vi.fn().mockReturnValue({ id: 'msg-1', body: 'hello', roomId: 'room-1' })
}));

vi.mock('\$lib/server/pty-inject-fanout', () => ({
  fanoutMessageToRoomTerminals: vi.fn()
}));

vi.mock('\$lib/server/eventBroadcast', () => ({
  broadcastToRoom: vi.fn()
}));

vi.mock('\$lib/server/allowlistGuard', () => ({
  canCallerActOnTerminal: vi.fn().mockReturnValue(true),
  OPERATOR_HANDLE: '@you'
}));

// CVE FIX B (2026-05-20): default to admin-bearer @you so the route's
// identity gate passes. Individual tests override via vi.mocked() to
// exercise the 401 / 403 / non-operator paths.
vi.mock('\$lib/server/authGate', () => ({
  resolveTerminalCallerHandle: vi.fn().mockReturnValue('@you')
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-for-agent-launch-cve-fix-b';

type AnyHandler = (event: unknown) => unknown;

// CVE FIX B (2026-05-20): body-supplied `callerHandle` is no longer trusted.
// Tests authenticate via admin-bearer (ANT_ADMIN_TOKEN) which maps to @you
// in resolveTerminalCallerHandle. This matches the route's production gate.
function eventFor(id: string, body?: unknown, opts?: { withAuth?: boolean }) {
  const url = new URL(`http://localhost/api/terminals/${id}/agent-launch`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.withAuth !== false) {
    headers['authorization'] = `Bearer ${TEST_ADMIN_TOKEN}`;
  }
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/terminals/:id/agent-launch', () => {
  // CVE FIX B (2026-05-20) — closes security-audit-2026-05-19.md Finding #2.
  it('POST 401 when no auth supplied (body-supplied callerHandle is ignored)', async () => {
    const { resolveTerminalCallerHandle } = await import('\$lib/server/authGate');
    vi.mocked(resolveTerminalCallerHandle).mockReturnValueOnce(null);
    const room = createChatRoom({ name: 'Launch Room', whoCreatedIt: '@you' });
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', linkedChatRoomId: room.id });
    const res = await run(
      POST as unknown as AnyHandler,
      // Even with callerHandle: '@you' in body, no resolvable identity → 401.
      eventFor('t-1', { message: 'go', callerHandle: '@you' }, { withAuth: false })
    );
    expect(res.status).toBe(401);
  });

  it('POST 201 launches agent message', async () => {
    const room = createChatRoom({ name: 'Launch Room', whoCreatedIt: '@you' });
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', linkedChatRoomId: room.id });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { message: 'go' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.messageId).toBe('msg-1');
    expect(body.roomId).toBe(room.id);
  });

  it('POST 400 on empty id', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('', { message: 'go' }));
    expect(res.status).toBe(400);
  });

  it('POST 400 when message missing', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', {}));
    expect(res.status).toBe(400);
  });

  it('POST 404 when terminal missing', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('missing', { message: 'go' }));
    expect(res.status).toBe(404);
  });

  it('POST 404 when no linked chat room', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha' });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { message: 'go' }));
    expect(res.status).toBe(404);
  });

  it('POST 403 when caller not allowed', async () => {
    // Caller resolves to a non-operator identity, and the allowlist guard
    // denies. Operator-bypass (@you) is skipped because the resolved handle
    // is @stranger, not @you.
    const { canCallerActOnTerminal } = await import('\$lib/server/allowlistGuard');
    const { resolveTerminalCallerHandle } = await import('\$lib/server/authGate');
    vi.mocked(resolveTerminalCallerHandle).mockReturnValueOnce('@stranger');
    vi.mocked(canCallerActOnTerminal).mockReturnValue(false);
    const room = createChatRoom({ name: 'Launch Room', whoCreatedIt: '@you' });
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', linkedChatRoomId: room.id });
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { message: 'go' }));
    expect(res.status).toBe(403);
  });
});
