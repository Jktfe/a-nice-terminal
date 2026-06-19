/**
 * /api/terminals POST — SPAWN-LOCALITY-GATE (2026-05-15, JWPK Slice B item 1).
 *
 * The gate blocks remote-bridge bearer tokens (Bearer rbt_*) from reaching
 * the raw-PTY spawn path. This file covers ONLY the gate behaviour — the
 * positive spawn path is exercised end-to-end by the live service.
 *
 * IMPORTANT: ptyClient.spawnTerminal is MOCKED below. Without the mock,
 * the "non-rbt passes the gate" tests proceed all the way through the
 * handler and have the real pty-daemon spawn live tmux sessions
 * (observed 2026-05-15 after first ship — zombie tmux sessions
 * t_71onoybz2h / t_ypxpoalblk surfaced unattended in JWPK's terminal).
 * The mock returns { alive: false } so the handler throws a 500 right
 * after the gate; tests then assert `status !== 403` to prove the gate
 * let the request through without actually spawning anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('$lib/server/ptyClient', () => ({
  spawnTerminal: vi.fn(async () => ({ alive: false })),
  listTerminals: vi.fn(async () => [])
}));

import { GET as terminalsGet, POST as terminalsPost } from './+server';
import { spawnTerminal } from '$lib/server/ptyClient';
import * as terminalsStore from '$lib/server/terminalsStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { bindHandle, ensureHandleOwnedBy, getHandleRow, getLiveBinding } from '$lib/server/handleBindingsStore';
import type { TerminalRow } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'GET' | 'POST', path: string, init: RequestInit = {}): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
  return { request, params: {}, url };
}

function seedLiveTerminal(id: string, agentKind: string | null): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminals (id, pid, pid_start, name, agent_kind, source, meta, created_at, updated_at)
       VALUES (?, 1, 'test', ?, ?, 'test', '{}', 1, 1)`
    )
    .run(id, `live-${id}`, agentKind);
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

describe('/api/terminals POST SPAWN-LOCALITY-GATE', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminals-spawn-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('rejects Bearer rbt_* (remote-bridge token) with 403', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer rbt_synthetic_remote_token_for_test'
        },
        body: JSON.stringify({ name: 'should-not-spawn' })
      })
    );
    expect(response.status).toBe(403);
  });

  it('rejects rbt_* irrespective of token suffix shape', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer rbt_'
        },
        body: JSON.stringify({})
      })
    );
    expect(response.status).toBe(403);
  });

  it('does NOT reject a non-rbt Bearer header at the spawn-locality gate', async () => {
    // A request with a different Bearer prefix (e.g. chair-handoff / chat-invite)
    // must NOT be rejected at this gate — the gate is rbt_-specific by design.
    // The request will then proceed and likely fail downstream because there's
    // no live pty-daemon in the test env; we only assert that the failure is
    // NOT the 403 produced by this gate.
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer admin_some_other_token'
        },
        body: JSON.stringify({ name: 'should-pass-gate' })
      })
    );
    // Anything that's NOT the 403 gate-rejection means the gate let it through.
    // 500 (pty-daemon not running) or 201 (if it somehow spawns) both pass.
    expect(response.status).not.toBe(403);
  });

  it('does NOT reject requests with no Authorization header', async () => {
    // The user's browser path sends no Authorization header. This must pass
    // the gate so the existing UX is not broken by the JWPK-pragmatic shape.
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'browser-flow' })
      })
    );
    expect(response.status).not.toBe(403);
  });
});

describe('/api/terminals GET terminal CLI projection', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminals-get-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('returns live terminals.agent_kind over stale terminal_records.agent_kind', async () => {
    createTerminalRecord({ sessionId: 't_cli_drift', name: 'drift', agentKind: 'claude' });
    seedLiveTerminal('t_cli_drift', 'codex');
    const response = await runHandler(terminalsGet as unknown as AnyHandler, eventFor('GET', '/api/terminals'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.terminals).toEqual([
      expect.objectContaining({ sessionId: 't_cli_drift', agentKind: 'codex' })
    ]);
  });

  it('adds the canonical Desk/claim/binding/profile read model without removing legacy fields', async () => {
    createTerminalRecord({
      sessionId: 't_desk_model',
      name: 'Desk Model',
      handle: '@desk-model',
      createdBy: '@JWPK',
      allowlist: ['@JWPK', '@reviewer'],
      agentKind: 'claude',
      bootCommand: 'claude --remote-control',
      cliSessionId: 'cli-session-1',
      cliSessionSource: 'claude-code'
    });
    seedLiveTerminal('t_desk_model', 'codex');
    getIdentityDb()
      .prepare(
        `UPDATE terminals
            SET meta = ?, account_type = ?, model_family = ?, last_path = ?,
                agent_status = 'working', pane_status = 'verified'
          WHERE id = ?`
      )
      .run(
        JSON.stringify({ deliveryMode: 'queue_raw', deliveryTargetMode: 'handle_only' }),
        'pro',
        'opus',
        '/Users/jamesking/CascadeProjects/a-nice-terminal',
        't_desk_model'
      );
    bindHandle({
      handle: '@desk-model',
      pane: 't_desk_model:0.0',
      pid: 1234,
      pidStart: '2026-06-19T00:00:00.000Z',
      spawnedBy: '@JWPK',
      terminalId: 't_desk_model',
      atMs: 1_000
    });
    ensureHandleOwnedBy('@desk-model', '@JWPK', {
      actor: '@JWPK',
      reason: 'test-owner',
      atMs: 1_001
    });

    const response = await runHandler(terminalsGet as unknown as AnyHandler, eventFor('GET', '/api/terminals'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const terminal = body.terminals.find((row: { sessionId: string }) => row.sessionId === 't_desk_model');

    expect(terminal).toMatchObject({
      sessionId: 't_desk_model',
      handle: '@desk-model',
      agentKind: 'codex',
      desk: {
        id: 't_desk_model',
        name: 'Desk Model',
        lifecycle: 'active',
        ownerHandles: ['@JWPK']
      },
      antHandleClaim: {
        handle: '@desk-model',
        lifecycle: 'active',
        owners: ['@JWPK'],
        source: 'handles'
      },
      paneBinding: {
        state: 'bound',
        witnessed: true,
        handle: '@desk-model',
        tmuxPane: 't_desk_model:0.0',
        pid: 1234,
        pidStart: '2026-06-19T00:00:00.000Z',
        terminalId: 't_desk_model',
        boundAtMs: 1_000
      },
      cliProfile: {
        cliType: 'codex',
        accountType: 'pro',
        cliFamily: 'opus',
        rootFolder: '/Users/jamesking/CascadeProjects/a-nice-terminal',
        bootCommand: 'claude --remote-control',
        cliSessionId: 'cli-session-1',
        cliSessionSource: 'claude-code'
      },
      terminalConfig: {
        coOwners: ['@JWPK', '@reviewer'],
        messageDeliveryType: 'queue_raw',
        deliveryTargetType: 'handle_only',
        currentStatus: 'working',
        paneStatus: 'verified'
      }
    });
  });
});

/**
 * Sec-iter2 Fix #2 (2026-05-30 enterprise security pass): API-layer
 * handle validation on POST /api/terminals. Closes the HIGH-severity
 * bypass where an attacker could POST { handle: '@admin' } and have the
 * terminal_records row persisted with handle='@admin', then exploit
 * the approver gate's resolveAuthoritativeCallerHandle to gain admin.
 *
 * Both layers must reject the attempt:
 *   - API layer: 400 with the validator `message` so the operator sees
 *     a precise reason (e.g. "handle '@admin' is reserved").
 *   - Store layer (Fix #1): tagged Error throw as defense in depth so
 *     even a future writer that forgets the API-side check still fails
 *     closed.
 *
 * The tests below cover the API-layer behaviour; the store-layer
 * behaviour is covered in terminalRecordsStore.test.ts.
 */
describe('/api/terminals POST sec-iter2 Fix #2: API-layer handle validation', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminals-iter2-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('rejects { handle: "@admin" } with 400 (the exact iter2-review exploit)', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 't_attack', handle: '@admin' })
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json().catch(() => ({}));
    // The message must NOT be 201 ("created") and must reference the
    // reason structure from handleValidation.ts.
    expect(typeof body.message === 'string' || typeof body === 'string').toBe(true);
  });

  it('rejects every other reserved handle (case-insensitive)', async () => {
    for (const handle of ['@ADMIN', '@you', '@system', '@chair']) {
      const response = await runHandler(
        terminalsPost as unknown as AnyHandler,
        eventFor('POST', '/api/terminals', {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: `t_r_${handle.slice(1)}`, handle })
        })
      );
      expect(response.status).toBe(400);
    }
  });

  it('rejects handles with invalid characters with 400', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 't_bad', handle: '@bad space!' })
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects handles that are too short with 400', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 't_short', handle: '@' })
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects attempts to spawn or attach a terminal as the server handle', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 't_server_handle_claim', handle: '@JWPK' })
      })
    );
    expect(response.status).toBe(400);
  });

  it('does NOT reject when handle field is omitted (handle remains NULL)', async () => {
    // The 500 we expect here is from the mocked spawnTerminal returning
    // alive: false — the handle gate is the prior check and passes when
    // no handle is supplied. Any status other than 400 means we cleared
    // the validation gate (the gate is the only source of 400 in this
    // codepath for a body without handle).
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 't_no_handle' })
      })
    );
    expect(response.status).not.toBe(400);
  });

  it('accepts a valid non-reserved handle (validation passes)', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 't_ok', handle: '@alice-test' })
      })
    );
    // The mocked spawn returns alive=false so the request falls through
    // to a 500 from the spawn assertion — that's a pass-through of the
    // validation gate. Any status other than 400 (the only validation
    // failure code) means the gate accepted the handle.
    expect(response.status).not.toBe(400);
  });

  it('witnesses a supplied ANThandle on successful terminal create', async () => {
    vi.mocked(spawnTerminal).mockResolvedValueOnce({ alive: true });
    vi.spyOn(terminalsStore, 'autoRegisterTerminalForSpawnedSession').mockReturnValueOnce({
      id: 't_witness',
      pid: 4242,
      pid_start: '2026-06-18T08:20:00.000Z',
      name: 'auto:t_witness',
      tmux_target_pane: 't_witness:0.0',
      agent_kind: null,
      pane_status: 'unknown',
      pane_stale_since: null,
      source: 'spawn-auto',
      expires_at: null,
      meta: '{}',
      created_at: 1,
      updated_at: 1,
      status: 'live'
    } satisfies TerminalRow);

    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 't_witness',
          name: 't1',
          handle: 't1',
          user: '@jamesK'
        })
      })
    );

    expect(response.status).toBe(201);
    expect(getHandleRow('@t1')?.owners).toContain('@jamesK');
    expect(getLiveBinding('@t1')).toMatchObject({
      pane: 't_witness:0.0',
      pid: 4242,
      pid_start: '2026-06-18T08:20:00.000Z',
      terminal_id: 't_witness'
    });
    const ledger = getIdentityDb()
      .prepare(`SELECT kind, handle, actor FROM identity_ledger WHERE handle = ? ORDER BY id`)
      .all('@t1') as { kind: string; handle: string; actor: string | null }[];
    expect(ledger).toEqual([
      expect.objectContaining({ kind: 'binding.claimed', handle: '@t1', actor: 'daemon' }),
      expect.objectContaining({ kind: 'owner.added', handle: '@t1', actor: '@jamesK' })
    ]);
  });
});
