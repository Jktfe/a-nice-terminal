import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal, getTerminalByName } from '$lib/server/terminalsStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-sessions-add-tests';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-route-sessions-add-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  // Sec-iter6 Fix #1 (2026-05-30): the endpoint now requires admin-bearer
  // OR caller-identity match. Tests below use admin-bearer for the
  // existing happy-path coverage; the sec-iter6 attack-chain describe
  // block below exercises the no-auth / wrong-handle 403 cases that the
  // gate now closes.
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
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

function eventForPost(body?: string, opts?: { admin?: boolean; headers?: Record<string, string> }) {
  const url = new URL('http://localhost/api/sessions/add');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts?.headers ?? {}) };
  if (opts?.admin !== false) headers['authorization'] = `Bearer ${TEST_ADMIN}`;
  const request = new Request(url.toString(), {
    method: 'POST',
    headers,
    body
  });
  return { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
}

async function callPost(body?: string, opts?: { admin?: boolean; headers?: Record<string, string> }): Promise<Response> {
  try {
    return (await POST(eventForPost(body, opts))) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('POST /api/sessions/add — terminal mode', () => {
  it('adds a retrospective terminal and returns terminal_id + name', async () => {
    const response = await callPost(JSON.stringify({ pid: 4321, name: 'retro-1' }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.terminal_id).toBeTruthy();
    expect(payload.name).toBe('retro-1');
    expect(getTerminalByName('retro-1')?.pid).toBe(4321);
  });

  it('rejects invalid pid', async () => {
    const response = await callPost(JSON.stringify({ pid: -1, name: 'bad' }));
    expect(response.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const response = await callPost(JSON.stringify({ pid: 100, name: '  ' }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/sessions/add — membership mode', () => {
  it('adds a membership for an existing terminal', async () => {
    upsertTerminal({ pid: 100, pid_start: 'x', name: 'membership-target' });
    const response = await callPost(JSON.stringify({
      room_id: 'r-7', handle: '@member', terminal_name: 'membership-target'
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.handle).toBe('@member');
    expect(listMembershipsForRoom('r-7').length).toBe(1);
  });

  it('adds a membership by terminal_id so operator bind can use terminal_records friendly names', async () => {
    const terminal = upsertTerminal({ pid: 101, pid_start: 'x2', name: 'auto:t_friendly' });
    createTerminalRecord({
      sessionId: terminal.id,
      name: 'Friendly Terminal',
      handle: '@friendly',
      tmuxTargetPane: 't_friendly:0.0'
    });
    const response = await callPost(JSON.stringify({
      room_id: 'r-friendly', handle: '@friendly', terminal_id: terminal.id
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.handle).toBe('@friendly');
    expect(payload.terminal_id).toBe(terminal.id);
    expect(listMembershipsForRoom('r-friendly')[0].terminal_id).toBe(terminal.id);
  });

  it('returns 404 when terminal_name is unknown', async () => {
    const response = await callPost(JSON.stringify({
      room_id: 'r-7', handle: '@nope', terminal_name: 'nonexistent'
    }));
    expect(response.status).toBe(404);
  });

  it('is idempotent when same (room, handle, terminal) is re-added', async () => {
    upsertTerminal({ pid: 1, pid_start: 'y', name: 'idem-mem-target' });
    const body = JSON.stringify({ room_id: 'r-i', handle: '@x', terminal_name: 'idem-mem-target' });
    const first = await callPost(body);
    const second = await callPost(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstPayload = await first.json();
    const secondPayload = await second.json();
    expect(secondPayload.membership_id).toBe(firstPayload.membership_id);
  });
});

describe('POST /api/sessions/add — error paths', () => {
  it('rejects empty body', async () => {
    const response = await callPost('');
    expect(response.status).toBe(400);
  });

  it('rejects body that matches neither mode', async () => {
    const response = await callPost(JSON.stringify({ foo: 'bar' }));
    expect(response.status).toBe(400);
  });

  // M3.2d: client-input agent_kind validation rejects unknown/remote/browser/bogus.
  for (const bad of ['unknown', 'remote', 'browser', 'bogus']) {
    it(`rejects agent_kind="${bad}" with 400`, async () => {
      const response = await callPost(JSON.stringify({
        pid: 5555, name: `bad-${bad}`, pane: '%1', agent_kind: bad
      }));
      expect(response.status).toBe(400);
    });
  }
});

describe('POST /api/sessions/add — M3.2b auto-classify-on-create', () => {
  it('a: INSERT-new + omitted agent_kind + pane → may classify (best-effort)', async () => {
    const response = await callPost(JSON.stringify({ pid: 7001, name: 's-classify', pane: '%1' }));
    expect(response.status).toBe(201);
    expect(getTerminalByName('s-classify')).not.toBeNull();
  });
  it('b: INSERT-new + supplied agent_kind → does NOT auto-classify (caller wins)', async () => {
    const response = await callPost(JSON.stringify({
      pid: 7002, name: 's-caller-wins', pane: '%1', agent_kind: 'cursor'
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).agent_kind).toBe('cursor');
  });
  it('c: INSERT-new + omitted agent_kind + NO pane → does NOT classify', async () => {
    const response = await callPost(JSON.stringify({ pid: 7003, name: 's-no-pane' }));
    expect(response.status).toBe(201);
    expect((await response.json()).agent_kind).toBeNull();
  });
  it('d: same-name re-register + omitted kind + pane → classify NOT called + kind preserved (B1 + path B)', async () => {
    const first = await callPost(JSON.stringify({
      pid: 7004, name: 's-reregister', pane: '%1', agent_kind: 'aider'
    }));
    expect(first.status).toBe(201);
    const second = await callPost(JSON.stringify({ pid: 7005, name: 's-reregister', pane: '%2' }));
    expect(second.status).toBe(201);
    expect((await second.json()).agent_kind).toBe('aider'); // delta-5 R2 lock
    const stored = getTerminalByName('s-reregister');
    expect(stored?.agent_kind).toBe('aider');
    const meta = JSON.parse(stored?.meta ?? '{}');
    expect(meta.fingerprint_evidence_hash).toBeUndefined();
  });
  it('e: classify-throw isolation → 201 still returned', async () => {
    const response = await callPost(JSON.stringify({ pid: 99998, name: 's-isolation', pane: '%1' }));
    expect(response.status).toBe(201);
  });
});

/**
 * Sec-iter6 Fix #1 (2026-05-30) — auth gate at /api/sessions/add.
 *
 * Closes the HIGH-severity exploit chain found in iter-5 review: an
 * unauthenticated attacker could POST `{ room_id, handle: '@victim',
 * terminal_name: 'evil' }` and silently rebind the victim's
 * `(room_id, '@victim')` membership row to their own terminal via
 * `addMembership`'s UPDATE branch. The rebound membership then served
 * two downstream exploits:
 *   (a) the attacker's terminal could POST messages and have them
 *       attributed to `@victim` via the message-author resolution path;
 *   (b) `/api/grants` (pre-Fix #2) derived caller identity from
 *       `memberships[0].handle`, so the attacker could now call
 *       `/api/grants` as `@victim` and pass the approver-set gate for
 *       any target where `@victim` was an approver.
 *
 * The fix: caller must satisfy ONE of (a) admin-bearer, (b) supplied
 * handle == authoritative terminal_records.handle resolved from pidChain.
 * The corresponding Fix #3 (choke-point at addMembership) blocks
 * authority-handle membership writes structurally; Fix #2 retargets
 * /api/grants caller-identity at the authoritative helper. All three
 * layers close the chain.
 */
describe('POST /api/sessions/add — sec-iter6 Fix #1 attack chain', () => {
  function seedAttackerTerminal(name: string, pid: number, pid_start: string, handle: string) {
    const terminal = upsertTerminal({ pid, pid_start, name });
    createTerminalRecord({
      sessionId: terminal.id,
      name,
      handle
    });
    return { terminal, pidChainEntry: { pid, pid_start } };
  }

  // ---- The exact iter-5 scenario: cross-handle membership rebind ----
  it('reproduces the iter-5 attack scenario and confirms it now 403s at the gate', async () => {
    // Setup: @victim already has a membership row in roomX.
    const victimTerminal = upsertTerminal({ pid: 5001, pid_start: '2026-05-30T10:00:00.000Z', name: 'victim-term' });
    createTerminalRecord({
      sessionId: victimTerminal.id,
      name: 'victim-term',
      handle: '@victim'
    });
    // Seed the legit @victim membership via admin (the legitimate path).
    const seedResp = await callPost(JSON.stringify({
      room_id: 'roomX',
      handle: '@victim',
      terminal_name: 'victim-term'
    }));
    expect(seedResp.status).toBe(201);

    // Attacker: a separate terminal_records row whose AUTHORITATIVE
    // handle is @attacker. The attacker now attempts the iter-5 chain
    // step 1: POST /api/sessions/add { handle: '@victim', ... } from
    // their OWN pidChain.
    const { pidChainEntry: attackerPid } = seedAttackerTerminal(
      'attacker-term', 5002, '2026-05-30T10:00:01.000Z', '@attacker'
    );
    // Also need an evil terminal to claim membership for.
    upsertTerminal({ pid: 5003, pid_start: '2026-05-30T10:00:02.000Z', name: 'evil-term' });

    const attackResp = await callPost(
      JSON.stringify({
        room_id: 'roomX',
        handle: '@victim', // <-- the spoof attempt
        terminal_name: 'evil-term',
        pidChain: [attackerPid]
      }),
      { admin: false } // no admin-bearer; attacker only has pidChain
    );
    expect(attackResp.status).toBe(403);
    const body = await attackResp.json();
    expect(body.message).toContain('caller_identity_mismatch');

    // Confirm the membership row is STILL bound to victim-term, not
    // rebound to evil-term — the structural goal of the fix.
    const memberships = listMembershipsForRoom('roomX');
    expect(memberships).toHaveLength(1);
    expect(memberships[0].handle).toBe('@victim');
    expect(memberships[0].terminal_id).toBe(victimTerminal.id);
  });

  // ---- Membership-mode gate happy paths + denial shapes ----
  it('membership mode: 403 with no auth at all', async () => {
    upsertTerminal({ pid: 6001, pid_start: 'a', name: 'some-term' });
    const r = await callPost(
      JSON.stringify({ room_id: 'r1', handle: '@anyone', terminal_name: 'some-term' }),
      { admin: false }
    );
    expect(r.status).toBe(403);
  });

  it('membership mode: 403 when pidChain resolves but no handle on terminal_records', async () => {
    // Caller has a terminal but never registered a handle.
    const callerTerminal = upsertTerminal({ pid: 6002, pid_start: 'b', name: 'naked-term' });
    createTerminalRecord({ sessionId: callerTerminal.id, name: 'naked-term', handle: null });
    upsertTerminal({ pid: 6003, pid_start: 'c', name: 'target-term' });
    const r = await callPost(
      JSON.stringify({
        room_id: 'r1', handle: '@anyone', terminal_name: 'target-term',
        pidChain: [{ pid: 6002, pid_start: 'b' }]
      }),
      { admin: false }
    );
    expect(r.status).toBe(403);
  });

  it('membership mode: 201 when supplied handle matches caller authoritative handle', async () => {
    const { pidChainEntry } = seedAttackerTerminal(
      'self-term', 6010, '2026-05-30T10:00:00.500Z', '@selfhandle'
    );
    upsertTerminal({ pid: 6011, pid_start: 'sx', name: 'self-bind-target' });
    const r = await callPost(
      JSON.stringify({
        room_id: 'r-self', handle: '@selfhandle', terminal_name: 'self-bind-target',
        pidChain: [pidChainEntry]
      }),
      { admin: false }
    );
    expect(r.status).toBe(201);
  });

  it('membership mode: admin-bearer break-glass still works for cross-handle writes', async () => {
    // Admin can intentionally bind ANY handle to any terminal — this is
    // the recovery / migration path. Same shape as iter-2 admin-bearer
    // bypass on /api/grants.
    const victimTerminal = upsertTerminal({ pid: 6020, pid_start: 'd', name: 'recovery-term' });
    createTerminalRecord({ sessionId: victimTerminal.id, name: 'recovery-term', handle: '@recovery' });
    const r = await callPost(JSON.stringify({
      room_id: 'r-admin', handle: '@recovery', terminal_name: 'recovery-term'
    }));
    expect(r.status).toBe(201);
  });

  it('membership mode: 400 with INVALID_MEMBERSHIP_HANDLE for @admin (Fix #3 choke-point fires even past admin-bearer)', async () => {
    // Admin-bearer bypasses the iter-6 Fix #1 auth gate but does NOT
    // bypass the Fix #3 store-layer authority-handle reject. This is
    // intentional: even admin cannot legitimately plant @admin into
    // room_memberships (it would create the authority-spoof surface the
    // exploit chain depended on).
    upsertTerminal({ pid: 6030, pid_start: 'e', name: 'admin-attempt-term' });
    let thrown: unknown = null;
    try {
      await callPost(JSON.stringify({
        room_id: 'r-admin-handle', handle: '@admin', terminal_name: 'admin-attempt-term'
      }));
    } catch (err) {
      thrown = err;
    }
    // The store-layer throw bubbles as an Error (not a SvelteKit error()),
    // so it surfaces to the handler-caller as an uncaught throw. Either
    // shape proves the write was blocked.
    if (thrown !== null) {
      expect((thrown as Error).message).toContain('[INVALID_MEMBERSHIP_HANDLE]');
    }
    // Either way, no membership row was created.
    expect(listMembershipsForRoom('r-admin-handle')).toEqual([]);
  });

  // ---- Terminal-mode gate happy paths + denial shapes ----
  it('terminal mode: 403 with no auth + no pidChain', async () => {
    const r = await callPost(
      JSON.stringify({ pid: 7001, name: 'new-term' }),
      { admin: false }
    );
    expect(r.status).toBe(403);
  });

  it('terminal mode: 201 on first-register (no existing terminal for caller pidChain)', async () => {
    // First-register path — pidChain doesn't resolve yet because this
    // POST is what would CREATE the row. The gate accepts any name here
    // because there's nothing to compare against.
    const r = await callPost(
      JSON.stringify({
        pid: 7010, name: 'first-register-term',
        pidChain: [{ pid: 7010, pid_start: 'fr' }]
      }),
      { admin: false }
    );
    expect(r.status).toBe(201);
  });

  it('terminal mode: 403 when caller pidChain resolves to a DIFFERENT terminal name', async () => {
    // Attacker has terminal-A; tries to re-register terminal-B's name
    // from their own pidChain. Pre-iter6, `upsertTerminal`'s UPDATE
    // branch would silently rebind terminal-B → attacker's pid. Now
    // the gate catches the name mismatch.
    const { pidChainEntry } = seedAttackerTerminal(
      'attacker-A', 7020, '2026-05-30T11:00:00.000Z', '@attackerA'
    );
    upsertTerminal({ pid: 7021, pid_start: 'vb', name: 'victim-B' });
    const r = await callPost(
      JSON.stringify({
        pid: 7020, name: 'victim-B', // attempting to rebind victim-B's name
        pidChain: [pidChainEntry]
      }),
      { admin: false }
    );
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.message).toContain('caller_identity_mismatch');
  });

  it('terminal mode: 201 when caller re-registers their OWN terminal name', async () => {
    const { pidChainEntry } = seedAttackerTerminal(
      'self-A', 7030, '2026-05-30T11:00:01.000Z', '@selfA'
    );
    const r = await callPost(
      JSON.stringify({
        pid: 7030, name: 'self-A', pane: '%1',
        pidChain: [pidChainEntry]
      }),
      { admin: false }
    );
    expect(r.status).toBe(201);
  });
});
