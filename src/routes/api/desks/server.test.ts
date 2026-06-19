import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GET as LIST_DESKS } from './+server';
import { GET as GET_DESK } from './[deskId]/+server';
import { GET as GET_ANT_VIEW } from './[deskId]/ant-view/+server';
import { POST as MOVE_HANDLE } from './[deskId]/handle/move/+server';
import { POST as CLAIM_HANDLE } from './[deskId]/handle/claim/+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { appendTerminalRunEvent } from '$lib/server/terminalRunEventsStore';
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
const TEST_ADMIN_TOKEN = 'test-admin-token-for-desks-facade';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> = {},
  body?: Record<string, unknown>,
  opts: { withAuth?: boolean } = {}
): unknown {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.withAuth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    params,
    url,
    request: new Request(url, {
      method,
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
  agentKind?: string | null;
  meta?: Record<string, unknown>;
  lastPath?: string | null;
  contextFill?: number | null;
}): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminals
         (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
          source, meta, created_at, updated_at, last_path, agent_context_fill)
       VALUES (?, ?, ?, ?, ?, ?, 'verified', 'test', ?, 1, 1, ?, ?)`
    )
    .run(
      input.id,
      input.pid,
      input.pidStart,
      input.name,
      input.pane,
      input.agentKind ?? 'claude',
      JSON.stringify(input.meta ?? {}),
      input.lastPath ?? null,
      input.contextFill ?? null
    );
}

describe('/api/desks facade', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-desks-facade-'));
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

  it('lists and fetches TerminalDesk documents in the antOS shape', async () => {
    createTerminalRecord({
      sessionId: 't_desk',
      name: 'Test Desk',
      handle: '@desk',
      createdBy: '@JWPK',
      allowlist: ['@ecoantcodex'],
      tmuxTargetPane: 't_desk:0.0',
      bootCommand: 'claude --remote-control',
      cliSessionId: 'cli-session-1',
      cliSessionSource: 'claude-code'
    });
    seedTerminalRow({
      id: 't_desk',
      pid: 321,
      pidStart: 'start-321',
      pane: 't_desk:0.0',
      name: 'Test Desk',
      meta: {
        persistence: '7d',
        deliveryMode: 'queue_raw',
        deliveryTargetMode: 'handle_only',
        killDefault: 'archive',
        writeGrants: [{ handle: '@ecoantclaude', mode: 'read_write' }]
      },
      lastPath: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      contextFill: 42
    });
    ensureHandleOwnedBy('@desk', '@JWPK', { actor: '@JWPK', reason: 'test' });
    bindHandle({
      handle: '@desk',
      pane: 't_desk:0.0',
      pid: 321,
      pidStart: 'start-321',
      terminalId: 't_desk',
      spawnedBy: '@JWPK'
    });

    const listResponse = await run(LIST_DESKS as unknown as AnyHandler, eventFor('GET', '/api/desks'));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.desks).toHaveLength(1);
    expect(listBody.desks[0]).toMatchObject({
      deskId: 't_desk',
      name: 'Test Desk',
      displayHandle: '@desk',
      lifecycle: 'active',
      owners: ['@JWPK', '@ecoantcodex'],
      claim: {
        handle: '@desk',
        lifecycle: 'active',
        owners: ['@JWPK']
      },
      activeBinding: {
        state: 'bound',
        source: 'handle_binding',
        terminalId: 't_desk',
        pane: 't_desk:0.0',
        pid: 321,
        pidStart: 'start-321'
      },
      cliProfile: {
        cli: 'claude',
        bootCommand: 'claude --remote-control',
        cliSessionId: 'cli-session-1',
        cliSessionSource: 'claude-code',
        rootFolder: '/Users/jamesking/CascadeProjects/a-nice-terminal',
        contextFill: 42
      },
      config: {
        persistence: '7d',
        messageDelivery: 'queue_raw',
        deliveryTarget: 'handle_only',
        defaultKillAction: 'archive',
        coOwners: ['@ecoantcodex'],
        writeGrants: [{ handle: '@ecoantclaude', mode: 'read_write' }]
      }
    });

    const fetchResponse = await run(
      GET_DESK as unknown as AnyHandler,
      eventFor('GET', '/api/desks/t_desk', { deskId: 't_desk' })
    );
    expect(fetchResponse.status).toBe(200);
    const fetchBody = await fetchResponse.json();
    expect(fetchBody.desk.deskId).toBe('t_desk');
    expect(fetchBody.desk.config.persistence).toBe('7d');
  });

  it('serves server-classified ANT View blocks for a Desk', async () => {
    createTerminalRecord({
      sessionId: 't_view',
      name: 'View Desk',
      handle: '@view',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_view:0.0'
    });
    appendTerminalRunEvent({
      terminalId: 't_view',
      kind: 'command_block',
      text: 'cd /Users/jamesking/CascadeProjects/a-nice-terminal',
      source: 'pty',
      trust: 'high',
      tsMs: 1_000
    });
    appendTerminalRunEvent({
      terminalId: 't_view',
      kind: 'success',
      text: 'done',
      source: 'pty',
      trust: 'high',
      tsMs: 2_000
    });
    appendTerminalRunEvent({
      terminalId: 't_view',
      kind: 'raw',
      text: 'raw frame',
      source: 'pty',
      trust: 'raw',
      tsMs: 3_000
    });

    const response = await run(
      GET_ANT_VIEW as unknown as AnyHandler,
      eventFor('GET', '/api/desks/t_view/ant-view?grep=cd&limit=10', { deskId: 't_view' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mode).toBe('search');
    expect(body.query).toBe('cd');
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0]).toMatchObject({
      deskId: 't_view',
      terminalId: 't_view',
      kind: 'command_block',
      viewKind: 'command',
      text: 'cd /Users/jamesking/CascadeProjects/a-nice-terminal'
    });
  });

  it('moves a handle claim and returns the updated Desk envelope', async () => {
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
    seedTerminalRow({ id: 't_old', pid: 111, pidStart: 'old-start', pane: 't_old:0.0', name: 'Old Desk' });
    seedTerminalRow({ id: 't_new', pid: 222, pidStart: 'new-start', pane: 't_new:0.0', name: 'New Desk' });
    ensureHandleOwnedBy('@move-me', '@JWPK', { actor: '@JWPK', reason: 'test-owner' });
    bindHandle({
      handle: '@move-me',
      pane: 't_old:0.0',
      pid: 111,
      pidStart: 'old-start',
      terminalId: 't_old',
      spawnedBy: '@JWPK'
    });
    bindHandle({
      handle: '@old-target',
      pane: 't_new:0.0',
      pid: 222,
      pidStart: 'new-start',
      terminalId: 't_new',
      spawnedBy: '@JWPK'
    });

    const response = await run(
      MOVE_HANDLE as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/t_new/handle/move',
        { deskId: 't_new' },
        { handle: 'move-me', reason: 'fresh-pane-reclaim' }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      handle: '@move-me',
      movedFromDeskId: 't_old',
      desk: {
        deskId: 't_new',
        displayHandle: '@move-me',
        claim: { handle: '@move-me' },
        activeBinding: {
          state: 'bound',
          source: 'handle_binding',
          pane: 't_new:0.0',
          pid: 222,
          pidStart: 'new-start'
        }
      }
    });
    expect(getTerminalRecord('t_old')?.handle).toBeNull();
    expect(getTerminalRecord('t_new')?.handle).toBe('@move-me');
    expect(getLiveBinding('@move-me')).toMatchObject({
      terminal_id: 't_new',
      pane: 't_new:0.0'
    });
    expect(getLiveBinding('@old-target')).toBeNull();
  });

  it('keeps /handle/claim as an alias of /handle/move', async () => {
    createTerminalRecord({
      sessionId: 't_alias',
      name: 'Alias Desk',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_alias:0.0'
    });

    const response = await run(
      CLAIM_HANDLE as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/t_alias/handle/claim',
        { deskId: 't_alias' },
        { handle: '@alias' }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.desk).toMatchObject({
      deskId: 't_alias',
      displayHandle: '@alias',
      claim: { handle: '@alias' }
    });
  });
});
