import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GET as LIST_DESKS } from './+server';
import { GET as GET_DESK } from './[deskId]/+server';
import { GET as GET_ANT_VIEW } from './[deskId]/ant-view/+server';
import { POST as MOVE_HANDLE } from './[deskId]/handle/move/+server';
import { POST as CLAIM_HANDLE } from './[deskId]/handle/claim/+server';
import { POST as BIND_PANE } from './[deskId]/binding/bind/+server';
import { POST as TOMBSTONE_PANE } from './[deskId]/binding/tombstone/+server';
import { POST as SWAP_CLI_PROFILE } from './[deskId]/cli-profile/swap/+server';
import { PATCH as UPDATE_CONFIG } from './[deskId]/config/+server';
import { POST as ARCHIVE_DESK } from './[deskId]/archive/+server';
import { POST as MINE_DESK } from './[deskId]/mine/+server';
import { POST as DELETE_DESK } from './[deskId]/delete/+server';
import { POST as ADOPT_PANE } from './adopt-pane/+server';
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
import { createChatRoom, findChatRoomById } from '$lib/server/chatRoomStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const previousArchiveDir = process.env.ANT_TERMINAL_ARCHIVE_DIR;
const TEST_ADMIN_TOKEN = 'test-admin-token-for-desks-facade';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'GET' | 'POST' | 'PATCH',
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
    process.env.ANT_TERMINAL_ARCHIVE_DIR = join(tmpDir, 'archives');
    resetIdentityDbForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbPath;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
    if (previousArchiveDir === undefined) delete process.env.ANT_TERMINAL_ARCHIVE_DIR;
    else process.env.ANT_TERMINAL_ARCHIVE_DIR = previousArchiveDir;
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

  it('patches Desk config through the antOS envelope', async () => {
    createTerminalRecord({
      sessionId: 't_config',
      name: 'Config Desk',
      handle: '@config',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_config:0.0'
    });
    seedTerminalRow({
      id: 't_config',
      pid: 333,
      pidStart: 'config-start',
      pane: 't_config:0.0',
      name: 'Config Desk'
    });

    const response = await run(
      UPDATE_CONFIG as unknown as AnyHandler,
      eventFor(
        'PATCH',
        '/api/desks/t_config/config',
        { deskId: 't_config' },
        {
          persistence: '24h',
          coOwners: ['ecoantclaude'],
          writeGrants: [{ handle: 'ecoantcodex', mode: 'read_write' }],
          defaultKillAction: 'archive',
          messageDelivery: 'queue_summarise',
          deliveryTarget: 'handle_only'
        }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      terminalRowUpdated: true,
      recordUpdated: true,
      config: {
        persistence: '24h',
        coOwners: ['@ecoantclaude'],
        writeGrants: [{ handle: '@ecoantcodex', mode: 'read_write' }],
        defaultKillAction: 'archive',
        messageDelivery: 'queue_summarise',
        deliveryTarget: 'handle_only'
      },
      desk: {
        deskId: 't_config',
        owners: ['@JWPK', '@ecoantclaude']
      }
    });
    const terminalMeta = getIdentityDb()
      .prepare(`SELECT meta FROM terminals WHERE id = ?`)
      .get('t_config') as { meta: string };
    expect(JSON.parse(terminalMeta.meta)).toMatchObject({
      persistence: '24h',
      coOwners: ['@ecoantclaude'],
      writeGrants: [{ handle: '@ecoantcodex', mode: 'read_write' }],
      killDefault: 'archive',
      deliveryMode: 'queue_summarise',
      deliveryTargetMode: 'handle_only'
    });
    expect(getTerminalRecord('t_config')?.allowlist).toBe(JSON.stringify(['@ecoantclaude']));
  });

  it('swaps the CLI profile without changing the Desk identity', async () => {
    createTerminalRecord({
      sessionId: 't_cli',
      name: 'CLI Desk',
      handle: '@cli',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_cli:0.0',
      bootCommand: 'claude',
      cliSessionId: 'old-session',
      cliSessionSource: 'claude-code'
    });
    seedTerminalRow({
      id: 't_cli',
      pid: 444,
      pidStart: 'cli-start',
      pane: 't_cli:0.0',
      name: 'CLI Desk',
      agentKind: 'claude'
    });

    const response = await run(
      SWAP_CLI_PROFILE as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/t_cli/cli-profile/swap',
        { deskId: 't_cli' },
        {
          cli: 'codex',
          subscription: 'team',
          modelFamily: 'gpt-5-codex',
          rootFolder: '/tmp/ant',
          bootCommand: 'codex',
          cliSessionId: 'new-session',
          cliSessionSource: 'codex'
        }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      terminalRowUpdated: true,
      profile: {
        cli: 'codex',
        accountType: 'team',
        modelFamily: 'gpt-5-codex',
        rootFolder: '/tmp/ant',
        bootCommand: 'codex',
        cliSessionId: 'new-session',
        cliSessionSource: 'codex'
      },
      desk: {
        deskId: 't_cli',
        displayHandle: '@cli',
        claim: { handle: '@cli' }
      }
    });
    expect(getTerminalRecord('t_cli')).toMatchObject({
      handle: '@cli',
      agent_kind: 'codex',
      boot_command: 'codex',
      cli_session_id: 'new-session',
      cli_session_source: 'codex'
    });
  });

  it('binds and tombstones a Desk pane through explicit verbs', async () => {
    createTerminalRecord({
      sessionId: 't_bind',
      name: 'Bind Desk',
      handle: '@bind',
      createdBy: '@JWPK',
      tmuxTargetPane: 'old-pane'
    });

    const bindResponse = await run(
      BIND_PANE as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/t_bind/binding/bind',
        { deskId: 't_bind' },
        { pane: 'new-pane', pid: 555, pidStart: 'bind-start' }
      )
    );

    expect(bindResponse.status).toBe(200);
    const bindBody = await bindResponse.json();
    expect(bindBody).toMatchObject({
      tombstoned: false,
      binding: {
        state: 'bound',
        source: 'handle_binding',
        terminalId: 't_bind',
        pane: 'new-pane',
        pid: 555,
        pidStart: 'bind-start'
      },
      desk: {
        deskId: 't_bind',
        activeBinding: { pane: 'new-pane' }
      }
    });
    expect(getTerminalRecord('t_bind')?.tmux_target_pane).toBe('new-pane');
    expect(getLiveBinding('@bind')).toMatchObject({
      pane: 'new-pane',
      terminal_id: 't_bind'
    });

    const tombstoneResponse = await run(
      TOMBSTONE_PANE as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/t_bind/binding/tombstone',
        { deskId: 't_bind' },
        { reason: 'pane-killed' }
      )
    );

    expect(tombstoneResponse.status).toBe(200);
    const tombstoneBody = await tombstoneResponse.json();
    expect(tombstoneBody).toMatchObject({
      tombstoned: true,
      binding: {
        state: 'missing',
        source: 'none'
      },
      desk: {
        deskId: 't_bind',
        lifecycle: 'parked'
      }
    });
    expect(getLiveBinding('@bind')).toBeNull();
  });

  it('archives a Desk as a parked lifecycle state without deleting history', async () => {
    const linkedRoom = createChatRoom({ name: 'linked archive', whoCreatedIt: '@JWPK' });
    createTerminalRecord({
      sessionId: 't_archive',
      name: 'Archive Desk',
      handle: '@archive',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_archive:0.0',
      linkedChatRoomId: linkedRoom.id
    });
    seedTerminalRow({
      id: 't_archive',
      pid: 777,
      pidStart: 'archive-start',
      pane: 't_archive:0.0',
      name: 'Archive Desk'
    });
    bindHandle({
      handle: '@archive',
      pane: 't_archive:0.0',
      pid: 777,
      pidStart: 'archive-start',
      terminalId: 't_archive',
      spawnedBy: '@JWPK'
    });

    const response = await run(
      ARCHIVE_DESK as unknown as AnyHandler,
      eventFor('POST', '/api/desks/t_archive/archive', { deskId: 't_archive' }, { reason: 'done' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      archived: true,
      terminalStatusUpdated: true,
      linkedChatArchived: true,
      bindingTombstoned: true,
      desk: {
        deskId: 't_archive',
        lifecycle: 'parked',
        activeBinding: { state: 'missing' }
      }
    });
    expect(findChatRoomById(linkedRoom.id)).toBeUndefined();
    expect(getLiveBinding('@archive')).toBeNull();
  });

  it('mines a Desk without deleting the Desk', async () => {
    createTerminalRecord({
      sessionId: 't_mine',
      name: 'Mine Desk',
      handle: '@mine',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_mine:0.0'
    });
    appendTerminalRunEvent({
      terminalId: 't_mine',
      kind: 'command_block',
      text: 'npm test',
      trust: 'high',
      source: 'pty',
      tsMs: 123
    });

    const response = await run(
      MINE_DESK as unknown as AnyHandler,
      eventFor('POST', '/api/desks/t_mine/mine', { deskId: 't_mine' }, { reason: 'preserve' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      terminalId: 't_mine',
      mined: { eventsArchived: 1 },
      desk: { deskId: 't_mine' }
    });
    expect(body.mined.archivedTo).toContain('/archives/');
    expect(getTerminalRecord('t_mine')).not.toBeNull();
  });

  it('deletes an inactive Desk with mine-first truthfulness', async () => {
    const linkedRoom = createChatRoom({ name: 'delete linked', whoCreatedIt: '@JWPK' });
    createTerminalRecord({
      sessionId: 't_delete',
      name: 'Delete Desk',
      handle: '@delete',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_delete:0.0',
      linkedChatRoomId: linkedRoom.id
    });
    appendTerminalRunEvent({
      terminalId: 't_delete',
      kind: 'output',
      text: 'important output',
      trust: 'medium',
      source: 'pty',
      tsMs: 234
    });

    const response = await run(
      DELETE_DESK as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/t_delete/delete',
        { deskId: 't_delete' },
        { mode: 'mine-and-delete' }
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      mode: 'mine-and-delete',
      deleted: true,
      terminalId: 't_delete',
      mined: { eventsArchived: 1 },
      runEventsHidden: 1,
      linkedChatDeleted: true,
      deskBefore: { deskId: 't_delete', displayHandle: '@delete' }
    });
    expect(getTerminalRecord('t_delete')).toBeNull();
    expect(findChatRoomById(linkedRoom.id)).toBeUndefined();
  });

  it('adopts a loose tmux pane into a witnessed Desk', async () => {
    const response = await run(
      ADOPT_PANE as unknown as AnyHandler,
      eventFor(
        'POST',
        '/api/desks/adopt-pane',
        {},
        {
          deskId: 't_adopted',
          pane: 'loose:0.0',
          handle: 'adopted',
          name: 'Adopted Desk',
          cli: 'claude',
          bootCommand: 'claude --remote-control',
          pid: 888,
          pidStart: '2026-06-19T01:02:03.000Z'
        }
      )
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      adopted: {
        deskId: 't_adopted',
        handle: '@adopted',
        pane: 'loose:0.0',
        pid: 888,
        pidStart: '2026-06-19T01:02:03.000Z'
      },
      desk: {
        deskId: 't_adopted',
        name: 'Adopted Desk',
        displayHandle: '@adopted',
        claim: { handle: '@adopted' },
        activeBinding: {
          state: 'bound',
          source: 'handle_binding',
          pane: 'loose:0.0',
          pid: 888,
          pidStart: '2026-06-19T01:02:03.000Z'
        },
        cliProfile: {
          cli: 'claude',
          bootCommand: 'claude --remote-control'
        }
      }
    });
    expect(getTerminalRecord('t_adopted')).toMatchObject({
      handle: '@adopted',
      tmux_target_pane: 'loose:0.0',
      linked_chat_room_id: body.adopted.linkedChatRoomId
    });
    expect(getLiveBinding('@adopted')).toMatchObject({
      terminal_id: 't_adopted',
      pane: 'loose:0.0',
      pid: 888
    });
  });

  it('rejects unauthenticated Desk config writes', async () => {
    createTerminalRecord({
      sessionId: 't_noauth',
      name: 'No Auth Desk',
      handle: '@noauth',
      createdBy: '@JWPK',
      tmuxTargetPane: 't_noauth:0.0'
    });
    seedTerminalRow({
      id: 't_noauth',
      pid: 666,
      pidStart: 'noauth-start',
      pane: 't_noauth:0.0',
      name: 'No Auth Desk'
    });

    const response = await run(
      UPDATE_CONFIG as unknown as AnyHandler,
      eventFor(
        'PATCH',
        '/api/desks/t_noauth/config',
        { deskId: 't_noauth' },
        { persistence: '1h' },
        { withAuth: false }
      )
    );

    expect(response.status).toBe(401);
  });
});
