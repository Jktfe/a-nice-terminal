import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POST } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import {
  bindHandle,
  ensureHandleOwnedBy,
  getLiveBinding
} from '$lib/server/handleBindingsStore';
import {
  createTerminalRecord,
  getTerminalRecord
} from '$lib/server/terminalRecordsStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-for-handle-claim-route';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  terminalId: string,
  body?: Record<string, unknown>,
  opts: { withAuth?: boolean } = {}
): unknown {
  const url = new URL(`http://localhost/api/terminals/${terminalId}/handle-claim`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.withAuth !== false) {
    headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  }
  return {
    params: { id: terminalId },
    url,
    request: new Request(url, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

function seedTerminalRow(input: {
  id: string;
  pid: number;
  pidStart: string;
  pane: string;
  name: string;
}): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminals
         (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
          source, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'codex', 'verified', 'test', '{}', 1, 1)`
    )
    .run(input.id, input.pid, input.pidStart, input.name, input.pane);
}

describe('POST /api/terminals/:id/handle-claim', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-handle-claim-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetIdentityDbForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbPath;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('moves an ANThandle claim onto the target Desk and witness-binds its live pane', async () => {
    createTerminalRecord({
      sessionId: 't_old',
      name: 'Old Desk',
      handle: '@move-me',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_old:0.0'
    });
    createTerminalRecord({
      sessionId: 't_new',
      name: 'New Desk',
      handle: '@old-target',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_new:0.0'
    });
    seedTerminalRow({
      id: 't_old',
      pid: 111,
      pidStart: 'old-start',
      pane: 't_old:0.0',
      name: 'Old Desk'
    });
    seedTerminalRow({
      id: 't_new',
      pid: 222,
      pidStart: 'new-start',
      pane: 't_new:0.0',
      name: 'New Desk'
    });
    ensureHandleOwnedBy('@move-me', '@JWPK', {
      actor: '@JWPK',
      reason: 'test-owner',
      atMs: 900
    });
    bindHandle({
      handle: '@move-me',
      pane: 't_old:0.0',
      pid: 111,
      pidStart: 'old-start',
      terminalId: 't_old',
      spawnedBy: '@JWPK',
      atMs: 1_000
    });
    bindHandle({
      handle: '@old-target',
      pane: 't_new:0.0',
      pid: 222,
      pidStart: 'new-start',
      terminalId: 't_new',
      spawnedBy: '@JWPK',
      atMs: 1_001
    });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor('t_new', {
        handle: 'move-me',
        reason: 'fresh-pane-reclaim'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      handle: '@move-me',
      targetTerminalId: 't_new',
      previousTerminalIds: ['t_old'],
      replacedHandle: '@old-target',
      binding: {
        bound: true,
        pane: 't_new:0.0',
        pid: 222,
        pidStart: 'new-start'
      }
    });
    expect(typeof body.binding.bindingId).toBe('number');

    expect(getTerminalRecord('t_old')?.handle).toBeNull();
    expect(getTerminalRecord('t_new')?.handle).toBe('@move-me');
    expect(getLiveBinding('@move-me')).toMatchObject({
      pane: 't_new:0.0',
      pid: 222,
      pid_start: 'new-start',
      terminal_id: 't_new'
    });
    expect(getLiveBinding('@old-target')).toBeNull();
    const ledgerRows = getIdentityDb()
      .prepare(`SELECT kind, handle, actor, detail FROM identity_ledger WHERE handle = ? ORDER BY id`)
      .all('@move-me') as { kind: string; handle: string; actor: string; detail: string }[];
    const moveRow = ledgerRows.find((row) => row.kind === 'handle.moved');
    expect(moveRow).toBeDefined();
    expect(moveRow?.actor).toBe('@JWPK');
    expect(JSON.parse(moveRow?.detail ?? '{}')).toMatchObject({
      reason: 'fresh-pane-reclaim',
      target_terminal_id: 't_new',
      previous_terminal_ids: ['t_old'],
      replaced_handle: '@old-target',
      binding_bound: true,
      pane: 't_new:0.0',
      pid: 222
    });
  });

  it('rejects unauthenticated move attempts', async () => {
    createTerminalRecord({
      sessionId: 't_target',
      name: 'Target',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_target:0.0'
    });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor('t_target', { handle: '@move-me' }, { withAuth: false })
    );

    expect(response.status).toBe(401);
    expect(getTerminalRecord('t_target')?.handle).toBeNull();
  });

  it('rejects invalid handles as bad input instead of a permission problem', async () => {
    createTerminalRecord({
      sessionId: 't_target',
      name: 'Target',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_target:0.0'
    });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor('t_target', { handle: '@bad handle' })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/handle may contain only letters/);
    expect(getTerminalRecord('t_target')?.handle).toBeNull();
  });
});
