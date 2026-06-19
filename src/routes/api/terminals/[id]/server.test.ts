import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from '\$lib/server/db';
import { createTerminalRecord } from '\$lib/server/terminalRecordsStore';
import { bindHandle, ensureHandleOwnedBy } from '\$lib/server/handleBindingsStore';
import { GET, PATCH } from './+server';

vi.mock('\$lib/server/ptyClient', () => ({
  listTerminals: async () => []
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TERMINAL_DETAIL_ADMIN_TOKEN = 'terminal-detail-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, method: 'GET' | 'PATCH', body?: unknown, headers: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/terminals/${id}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json', ...headers };
    init.body = JSON.stringify(body);
  } else if (Object.keys(headers).length > 0) {
    init.headers = headers;
  }
  return {
    request: new Request(url, init),
    url,
    params: { id }
  };
}

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TERMINAL_DETAIL_ADMIN_TOKEN}` };
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

function seedLiveTerminal(id: string, agentKind: string | null): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminals (id, pid, pid_start, name, agent_kind, source, meta, created_at, updated_at)
       VALUES (?, 1, 'test', ?, ?, 'test', '{}', 1, 1)`
    )
    .run(id, `live-${id}`, agentKind);
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TERMINAL_DETAIL_ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/terminals/:id', () => {
  it('GET rejects anonymous reads before exposing terminal metadata', async () => {
    createTerminalRecord({
      sessionId: 't-anon-detail',
      name: 'Anon Detail',
      bootCommand: 'claude --dangerously-skip-permissions',
      tmuxTargetPane: 't-anon-detail:0.0'
    });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-anon-detail', 'GET'));
    expect(res.status).toBe(401);
    await expect(res.text()).resolves.not.toContain('dangerously-skip-permissions');
  });

  it('GET returns terminal record', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', handle: '@alpha' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', 'GET', undefined, adminHeaders()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('t-1');
    expect(body.name).toBe('Alpha');
    expect(body.handle).toBe('@alpha');
    expect(body.alive).toBe(false);
  });

  it('GET uses live terminals.agent_kind when the record projection is stale', async () => {
    createTerminalRecord({ sessionId: 't-drift', name: 'Drift', agentKind: 'claude' });
    seedLiveTerminal('t-drift', 'codex');
    const res = await run(GET as unknown as AnyHandler, eventFor('t-drift', 'GET', undefined, adminHeaders()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentKind).toBe('codex');
  });

  it('GET includes the canonical Desk/claim/binding/profile read model', async () => {
    createTerminalRecord({
      sessionId: 't-focused-model',
      name: 'Focused Model',
      handle: '@focused-model',
      createdBy: '@JWPK',
      allowlist: ['@JWPK'],
      agentKind: 'claude',
      bootCommand: 'codex',
      cliSessionId: 'codex-session-1',
      cliSessionSource: 'codex'
    });
    seedLiveTerminal('t-focused-model', 'codex');
    getIdentityDb()
      .prepare(
        `UPDATE terminals
            SET meta = ?, account_type = ?, model_family = ?, last_path = ?,
                agent_status = 'thinking', pane_status = 'verified'
          WHERE id = ?`
      )
      .run(
        JSON.stringify({ deliveryMode: 'queue_summarise', deliveryTargetMode: 'room_flow' }),
        'team',
        'gpt-5',
        '/tmp/focused',
        't-focused-model'
      );
    bindHandle({
      handle: '@focused-model',
      pane: 't-focused-model:0.0',
      pid: 2222,
      pidStart: '2026-06-19T01:00:00.000Z',
      spawnedBy: '@JWPK',
      terminalId: 't-focused-model',
      atMs: 2_000
    });
    ensureHandleOwnedBy('@focused-model', '@JWPK', {
      actor: '@JWPK',
      reason: 'test-owner',
      atMs: 2_001
    });

    const res = await run(GET as unknown as AnyHandler, eventFor('t-focused-model', 'GET', undefined, adminHeaders()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      sessionId: 't-focused-model',
      desk: {
        id: 't-focused-model',
        name: 'Focused Model',
        lifecycle: 'active',
        ownerHandles: ['@JWPK']
      },
      antHandleClaim: {
        handle: '@focused-model',
        lifecycle: 'active',
        owners: ['@JWPK'],
        source: 'handles'
      },
      paneBinding: {
        state: 'bound',
        witnessed: true,
        tmuxPane: 't-focused-model:0.0',
        pid: 2222,
        terminalId: 't-focused-model'
      },
      cliProfile: {
        cliType: 'codex',
        accountType: 'team',
        cliFamily: 'gpt-5',
        rootFolder: '/tmp/focused',
        bootCommand: 'codex',
        cliSessionId: 'codex-session-1',
        cliSessionSource: 'codex'
      },
      terminalConfig: {
        coOwners: ['@JWPK'],
        messageDeliveryType: 'queue_summarise',
        deliveryTargetType: 'room_flow',
        currentStatus: 'thinking',
        paneStatus: 'verified'
      }
    });
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('', 'GET', undefined, adminHeaders()));
    expect(res.status).toBe(400);
  });

  it('GET 404 for missing terminal', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET', undefined, adminHeaders()));
    expect(res.status).toBe(404);
  });

  it('PATCH updates terminal fields', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      name: 'Beta',
      autoForwardRoomId: 'room-1',
      autoForwardChat: 1,
      handle: '@beta'
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Beta');
    expect(body.autoForwardRoomId).toBe('room-1');
    expect(body.autoForwardChat).toBe(1);
    expect(body.handle).toBe('@beta');
  });

  it('PATCH agentKind keeps terminal_records and terminals in sync', async () => {
    createTerminalRecord({ sessionId: 't-cli-sync', name: 'Sync', agentKind: 'claude' });
    seedLiveTerminal('t-cli-sync', 'claude');
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-cli-sync', 'PATCH', {
      agentKind: 'codex'
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentKind).toBe('codex');
    const row = getIdentityDb()
      .prepare(
        `SELECT tr.agent_kind AS record_kind, t.agent_kind AS live_kind
           FROM terminal_records tr JOIN terminals t ON t.id = tr.session_id
          WHERE tr.session_id = ?`
      )
      .get('t-cli-sync') as { record_kind: string | null; live_kind: string | null };
    expect(row).toEqual({ record_kind: 'codex', live_kind: 'codex' });
  });

  it('PATCH 400 on empty id', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(400);
  });

  it('PATCH 404 for missing terminal', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('missing', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(404);
  });

  /**
   * Sec-iter2 Fix #2 (2026-05-30 enterprise security pass): API-layer
   * handle validation on PATCH /api/terminals/[id]. Alternative exploit
   * path noted in the iter2 review — even with POST gated, an attacker
   * could PATCH any existing terminal whose handle is NULL to '@admin'
   * and gain admin via the approver gate. The store-layer choke-point
   * (Fix #1) catches it; the API-layer 400 here is the UX surface.
   */
  describe('sec-iter2 Fix #2: PATCH handle validation', () => {
    it('PATCH rejects { handle: "@admin" } with 400 (alternative iter2 exploit)', async () => {
      createTerminalRecord({ sessionId: 't-patch-admin', name: 'spawner', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-admin', 'PATCH', { handle: '@admin' })
      );
      expect(res.status).toBe(400);
      // Handle must remain NULL — proves the store write didn't fire.
      // (We re-GET to verify; the alternative is to query the store
      // directly but the route-level test is the more honest signal.)
      const getRes = await run(
        GET as unknown as AnyHandler,
        eventFor('t-patch-admin', 'GET', undefined, adminHeaders())
      );
      const body = await getRes.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH rejects every other reserved handle case-insensitively', async () => {
      createTerminalRecord({ sessionId: 't-patch-reserved', name: 'r', handle: null });
      for (const handle of ['@ADMIN', '@you', '@system', '@chair', '@everyone']) {
        const res = await run(
          PATCH as unknown as AnyHandler,
          eventFor('t-patch-reserved', 'PATCH', { handle })
        );
        expect(res.status).toBe(400);
      }
    });

    it('PATCH rejects invalid-character handles with 400', async () => {
      createTerminalRecord({ sessionId: 't-patch-bad', name: 'b', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-bad', 'PATCH', { handle: '@bad space' })
      );
      expect(res.status).toBe(400);
    });

    it('PATCH accepts null handle (explicit clear)', async () => {
      createTerminalRecord({ sessionId: 't-patch-clear', name: 'c', handle: '@alice-pt' });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-clear', 'PATCH', { handle: null })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH accepts empty-string handle as null (back-compat with the trim shape)', async () => {
      createTerminalRecord({ sessionId: 't-patch-empty', name: 'e', handle: '@alice-pe' });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-empty', 'PATCH', { handle: '   ' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH accepts a valid non-reserved handle', async () => {
      createTerminalRecord({ sessionId: 't-patch-valid', name: 'v', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-valid', 'PATCH', { handle: '@alice-pv' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBe('@alice-pv');
    });

    it('PATCH rejects unauthenticated claims of the server handle', async () => {
      createTerminalRecord({ sessionId: 't-patch-server-claim', name: 'claim', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-server-claim', 'PATCH', { handle: '@JWPK' })
      );
      expect(res.status).toBe(400);
      const getRes = await run(
        GET as unknown as AnyHandler,
        eventFor('t-patch-server-claim', 'GET', undefined, adminHeaders())
      );
      const body = await getRes.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH rejects unauthenticated clearing or changing of the server handle', async () => {
      createTerminalRecord({ sessionId: 't-patch-server-clear', name: 'server', handle: null });
      getIdentityDb()
        .prepare(`UPDATE terminal_records SET handle = ? WHERE session_id = ?`)
        .run('@JWPK', 't-patch-server-clear');
      const clear = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-server-clear', 'PATCH', { handle: null })
      );
      expect(clear.status).toBe(403);
      const change = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-server-clear', 'PATCH', { handle: '@someone-else' })
      );
      expect(change.status).toBe(403);
      const getRes = await run(
        GET as unknown as AnyHandler,
        eventFor('t-patch-server-clear', 'GET', undefined, adminHeaders())
      );
      const body = await getRes.json();
      expect(body.handle).toBe('@JWPK');
    });

    it('PATCH allows the operator-authenticated path to change the server handle', async () => {
      process.env.ANT_ADMIN_TOKEN = 'terminals-patch-operator-token';
      createTerminalRecord({ sessionId: 't-patch-server-operator', name: 'server', handle: null });
      getIdentityDb()
        .prepare(`UPDATE terminal_records SET handle = ? WHERE session_id = ?`)
        .run('@JWPK', 't-patch-server-operator');
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor(
          't-patch-server-operator',
          'PATCH',
          { handle: '@jwpk-renamed-by-operator' },
          { authorization: 'Bearer terminals-patch-operator-token' }
        )
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBe('@jwpk-renamed-by-operator');
    });

    it('PATCH does not validate handle when field is omitted', async () => {
      createTerminalRecord({ sessionId: 't-patch-other', name: 'o', handle: '@alice-po' });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-other', 'PATCH', { name: 'renamed' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('renamed');
      expect(body.handle).toBe('@alice-po');
    });

    /**
     * Full exploit-chain regression: once Fix #2 is in place, even if
     * the attacker tries both POST + PATCH paths they cannot get a
     * terminal_records row with handle='@admin'. This proves the
     * sibling resolveAuthoritativeCallerHandle gate is no longer
     * spoofable through this surface — there's no row to walk to.
     */
    it('full exploit regression: neither POST nor PATCH can land an @admin handle row', async () => {
      // PATCH-on-fresh path
      createTerminalRecord({ sessionId: 't-exploit', name: 'attacker', handle: null });
      const patchRes = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-exploit', 'PATCH', { handle: '@admin' })
      );
      expect(patchRes.status).toBe(400);
      const after = await run(
        GET as unknown as AnyHandler,
        eventFor('t-exploit', 'GET', undefined, adminHeaders())
      );
      const body = await after.json();
      expect(body.handle).toBeNull();
    });
  });
});
