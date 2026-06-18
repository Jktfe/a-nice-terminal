import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POST as archiveDeletePost } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { seedDefaultOrg } from '$lib/server/orgStore';
import { createTerminalRecord, getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import { appendTerminalRunEvent, listLatestTerminalRunEvents } from '$lib/server/terminalRunEventsStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousArchiveDir = process.env.ANT_TERMINAL_ARCHIVE_DIR;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-for-archive-delete';

type AnyHandler = (event: unknown) => unknown;

function eventFor(sessionId: string, body?: Record<string, unknown>, withAuth = true): unknown {
  const url = new URL(`http://localhost/api/terminals/${sessionId}/archive-delete`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
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

function seedArchivedTerminal(sessionId: string, name = 'archived term'): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminals (id, pid, pid_start, name, source, meta, created_at, updated_at, status)
       VALUES (?, 1, 'x', ?, 'test', '{}', 1, 1, 'archived')`
    )
    .run(sessionId, name);
  createTerminalRecord({
    sessionId,
    name,
    linkedChatRoomId: null,
    createdBy: '@you'
  });
}

describe('POST /api/terminals/:id/archive-delete', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-archive-delete-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    process.env.ANT_TERMINAL_ARCHIVE_DIR = join(tmpDir, 'mined');
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetIdentityDbForTests();
    seedDefaultOrg();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbPath;
    if (previousArchiveDir === undefined) delete process.env.ANT_TERMINAL_ARCHIVE_DIR;
    else process.env.ANT_TERMINAL_ARCHIVE_DIR = previousArchiveDir;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('delete removes the archived terminal from inventory while retaining run-events', async () => {
    seedArchivedTerminal('t_arch_delete', 'delete only');
    appendTerminalRunEvent({
      terminalId: 't_arch_delete',
      kind: 'message',
      source: 'transcript',
      trust: 'high',
      text: 'retained archive output'
    });

    const response = await runHandler(
      archiveDeletePost as unknown as AnyHandler,
      eventFor('t_arch_delete', { mode: 'delete' })
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { deleted: boolean; mined: unknown; terminalStatus: string };
    expect(body.deleted).toBe(true);
    expect(body.mined).toBeNull();
    expect(body.terminalStatus).toBe('deleted');
    expect(getTerminalRecord('t_arch_delete')).toBeNull();
    expect(getTerminalById('t_arch_delete')?.status).toBe('deleted');
    expect(listLatestTerminalRunEvents('t_arch_delete', 10).map((e) => e.text)).toContain('retained archive output');
  });

  it('mine-and-delete writes an archive file before removing the record', async () => {
    seedArchivedTerminal('t_arch_mine', 'mine first');
    appendTerminalRunEvent({
      terminalId: 't_arch_mine',
      kind: 'message',
      source: 'transcript',
      trust: 'high',
      text: 'mine this before deleting'
    });

    const response = await runHandler(
      archiveDeletePost as unknown as AnyHandler,
      eventFor('t_arch_mine', { mode: 'mine-and-delete' })
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      deleted: boolean;
      mined: { archivePath: string; eventCount: number; bytesWritten: number; truncated: boolean };
    };
    expect(body.deleted).toBe(true);
    expect(body.mined.eventCount).toBe(1);
    expect(body.mined.bytesWritten).toBeGreaterThan(0);
    expect(body.mined.truncated).toBe(false);
    expect(existsSync(body.mined.archivePath)).toBe(true);
    expect(readFileSync(body.mined.archivePath, 'utf8')).toContain('mine this before deleting');
    expect(getTerminalRecord('t_arch_mine')).toBeNull();
    expect(getTerminalById('t_arch_mine')?.status).toBe('deleted');
  });

  it('rejects live terminals so the route cannot bypass the kill/archive flow', async () => {
    seedArchivedTerminal('t_live_refuse', 'live refuse');
    getIdentityDb().prepare(`UPDATE terminals SET status = 'live' WHERE id = ?`).run('t_live_refuse');

    const response = await runHandler(
      archiveDeletePost as unknown as AnyHandler,
      eventFor('t_live_refuse', { mode: 'delete' })
    );

    expect(response.status).toBe(409);
    expect(getTerminalRecord('t_live_refuse')?.session_id).toBe('t_live_refuse');
  });
});
