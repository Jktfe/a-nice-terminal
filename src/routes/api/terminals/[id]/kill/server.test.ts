import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('$lib/server/ptyClient', () => ({
  killTerminal: vi.fn()
}));

import { POST as killTerminalPost } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, findChatRoomById, listChatRooms } from '$lib/server/chatRoomStore';
import { createTerminalRecord, getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import { seedDefaultOrg } from '$lib/server/orgStore';
import { bindHandle, getHandleRow, getLiveBinding } from '$lib/server/handleBindingsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-for-kill-route-cve-fix-b';

type AnyHandler = (event: unknown) => unknown;

// CVE FIX B (2026-05-20): body-supplied `callerHandle` is no longer trusted.
// Tests authenticate via admin-bearer (ANT_ADMIN_TOKEN) which maps to @you
// in resolveTerminalCallerHandle. This matches the route's production gate.
function eventFor(
  sessionId: string,
  body?: Record<string, unknown>,
  opts?: { withAuth?: boolean }
): unknown {
  const url = new URL(`http://localhost/api/terminals/${sessionId}/kill`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.withAuth !== false) {
    headers['authorization'] = `Bearer ${TEST_ADMIN_TOKEN}`;
  }
  const request = new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {})
  });
  return { request, params: { id: sessionId }, url };
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

describe('POST /api/terminals/:id/kill linked-chat lifecycle', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminal-kill-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetIdentityDbForTests();
    seedDefaultOrg();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  // CVE FIX B (2026-05-20) — closes security-audit-2026-05-19.md Finding #2.
  it('rejects unauthenticated calls with 401 (no body-supplied callerHandle bypass)', async () => {
    createTerminalRecord({
      sessionId: 't_unauth',
      name: 'unauth attempt',
      linkedChatRoomId: null,
      createdBy: '@you'
    });
    const response = await runHandler(
      killTerminalPost as unknown as AnyHandler,
      // Even with callerHandle: '@you' in the body, no auth header → 401.
      eventFor('t_unauth', { callerHandle: '@you' }, { withAuth: false })
    );
    expect(response.status).toBe(401);
  });

  it('ignores body-supplied callerHandle — admin-bearer @you wins even when body claims something else', async () => {
    const linkedRoom = createChatRoom({ name: 'Terminal: ignore body', whoCreatedIt: '@you' });
    createTerminalRecord({
      sessionId: 't_body_ignored',
      name: 'body ignored',
      linkedChatRoomId: linkedRoom.id,
      // created_by is @alice — pre-fix the body-supplied @you would bypass.
      createdBy: '@alice'
    });
    const response = await runHandler(
      killTerminalPost as unknown as AnyHandler,
      // Body claims @attacker but admin-bearer resolves to @you (operator bypass).
      eventFor('t_body_ignored', { callerHandle: '@attacker' })
    );
    expect(response.status).toBe(200);
  });

  it('archives the linked chat and keeps the terminal record as a hide mapping', async () => {
    const visibleRoom = createChatRoom({ name: 'visible team room', whoCreatedIt: '@you' });
    const linkedRoom = createChatRoom({ name: 'Terminal: linked', whoCreatedIt: '@you' });
    createTerminalRecord({
      sessionId: 't_linked_kill',
      name: 'linked terminal',
      linkedChatRoomId: linkedRoom.id,
      createdBy: '@you'
    });

    const response = await runHandler(
      killTerminalPost as unknown as AnyHandler,
      eventFor('t_linked_kill')
    );

    expect(response.status).toBe(200);
    expect(getTerminalRecord('t_linked_kill')?.linked_chat_room_id).toBe(linkedRoom.id);
    expect(findChatRoomById(linkedRoom.id)).toBeUndefined();
    expect(listChatRooms().map((room) => room.id)).toEqual([visibleRoom.id]);
  });

  it('mode=just-kill leaves the linked chat live and the terminal record intact', async () => {
    const linkedRoom = createChatRoom({ name: 'Terminal: stays', whoCreatedIt: '@you' });
    createTerminalRecord({
      sessionId: 't_just_kill',
      name: 'just-kill terminal',
      linkedChatRoomId: linkedRoom.id,
      createdBy: '@you'
    });

    const response = await runHandler(
      killTerminalPost as unknown as AnyHandler,
      eventFor('t_just_kill', { mode: 'just-kill' })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode?: string; killed?: boolean };
    expect(body.mode).toBe('just-kill');
    expect(body.killed).toBe(true);
    // Linked chat row remains live — neither archived nor deleted. (It's
    // intentionally hidden from listChatRooms via the inverse terminal_records
    // mapping, but findChatRoomById returns the row when it's not archived
    // and not soft-deleted — so a defined return confirms both invariants.)
    expect(findChatRoomById(linkedRoom.id)?.id).toBe(linkedRoom.id);
    // Terminal record is preserved so the operator can re-attach.
    expect(getTerminalRecord('t_just_kill')?.session_id).toBe('t_just_kill');
  });

  it('mode=delete fails safe to archive when no linked chat can be identified', async () => {
    // Terminal record exists but linkedChatRoomId is null — without a room
    // to soft-delete, the destructive path would orphan visibility state.
    // Fail-safe downgrades to 'archive' which is a no-op for null linked
    // chats, preserving the terminal_record + terminals row.
    createTerminalRecord({
      sessionId: 't_orphan_delete',
      name: 'no linked chat',
      linkedChatRoomId: null,
      createdBy: '@you'
    });

    const response = await runHandler(
      killTerminalPost as unknown as AnyHandler,
      eventFor('t_orphan_delete', { mode: 'delete' })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode?: string };
    expect(body.mode).toBe('archive');
    // Terminal record survives the fail-safe downgrade.
    expect(getTerminalRecord('t_orphan_delete')?.session_id).toBe('t_orphan_delete');
  });

  it('mode=delete removes the terminal record + terminal row and soft-deletes the linked chat', async () => {
    const visibleRoom = createChatRoom({ name: 'visible team room', whoCreatedIt: '@you' });
    const linkedRoom = createChatRoom({ name: 'Terminal: doomed', whoCreatedIt: '@you' });
    // Backing terminals row whose id matches the session_id, so the endpoint's
    // deleteTerminalById(sessionId) has a real terminal row to remove too.
    getIdentityDb()
      .prepare(
        `INSERT INTO terminals (id, pid, pid_start, name, source, meta, created_at, updated_at)
         VALUES ('t_delete_happy', 1, 'x', 'doomed terminal', 'cli-register', '{}', 1, 1)`
      )
      .run();
    createTerminalRecord({
      sessionId: 't_delete_happy',
      name: 'doomed terminal',
      linkedChatRoomId: linkedRoom.id,
      createdBy: '@you',
      handle: '@doomed'
    });
    bindHandle({
      handle: '@doomed',
      pane: 't_delete_happy:0.0',
      pid: 1,
      pidStart: 'x',
      terminalId: 't_delete_happy'
    });

    const response = await runHandler(
      killTerminalPost as unknown as AnyHandler,
      eventFor('t_delete_happy', { mode: 'delete' })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode?: string; killed?: boolean };
    expect(body.mode).toBe('delete'); // did NOT downgrade to archive
    expect(body.killed).toBe(true);
    // Fix #1: deleteTerminalById now removes the terminal_record atomically.
    expect(getTerminalRecord('t_delete_happy')).toBeNull();
    // The backing terminals row is gone too.
    expect(getTerminalById('t_delete_happy')).toBeNull();
    // The linked chat is soft-deleted (hidden from every surface).
    expect(findChatRoomById(linkedRoom.id)).toBeUndefined();
    expect(listChatRooms().map((room) => room.id)).toEqual([visibleRoom.id]);
    // The identity layer cannot stay pairable/live after the terminal is gone.
    expect(getHandleRow('@doomed')?.lifecycle).toBe('deleted');
    expect(getLiveBinding('@doomed')).toBeNull();
    expect(
      getIdentityDb()
        .prepare(`SELECT kind FROM identity_ledger WHERE handle = ? ORDER BY id`)
        .all('@doomed')
        .map((row) => (row as { kind: string }).kind)
    ).toContain('handle.deleted');
  });
});
