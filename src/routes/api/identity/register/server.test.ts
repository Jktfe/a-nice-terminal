import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { getSession } from '$lib/server/antSessionStore';
import {
  getTerminalById,
  getTerminalByName,
  setTerminalStatus,
  upsertTerminal
} from '$lib/server/terminalsStore';
import {
  addMembership,
  listMembershipsForRoom
} from '$lib/server/roomMembershipsStore';
import { findRoomHandleOwnerAtTime } from '$lib/server/roomHandleLeaseStore';
import {
  createTerminalRecord,
  getHandleAliases,
  getTerminalRecord
} from '$lib/server/terminalRecordsStore';
import { addMember, resolveMember as resolveMembershipMember } from '$lib/server/membershipStore';
import {
  claimHandle as claimCleanHandle,
  resolveMember as resolveCleanMember,
  isMember as isCleanMember
} from '$lib/server/roomHandleLeaseClean';
import { bindHandle, getLiveBinding, getHandleRow } from '$lib/server/handleBindingsStore';
import { listLedger } from '$lib/server/identityLedgerStore';
import { setListPanePidsForTests } from '$lib/server/paneFactCorroboration';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-route-register-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

function eventForPost(body?: string) {
  const url = new URL('http://localhost/api/identity/register');
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });
  return { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
}

async function callPost(body?: string): Promise<Response> {
  try {
    return (await POST(eventForPost(body))) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('POST /api/identity/register', () => {
  it('returns 201 with terminal_id + name on valid body', async () => {
    const response = await callPost(JSON.stringify({
      name: 'claude2-test',
      pids: [{ pid: 1234, pid_start: 'Tue May 13 00:00:00 2026' }],
      source: 'test'
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.terminal_id).toBeTruthy();
    expect(payload.name).toBe('claude2-test');
    const stored = getTerminalByName('claude2-test');
    expect(stored?.pid).toBe(1234);
  });

  it('rejects empty body with 400', async () => {
    const response = await callPost('');
    expect(response.status).toBe(400);
  });

  it('rejects missing name with 400', async () => {
    const response = await callPost(JSON.stringify({ pids: [{ pid: 1, pid_start: 'x' }] }));
    expect(response.status).toBe(400);
  });

  it('rejects empty pids array with 400', async () => {
    const response = await callPost(JSON.stringify({ name: 'n', pids: [] }));
    expect(response.status).toBe(400);
  });

  it('rejects pid <= 0 with 400', async () => {
    const response = await callPost(JSON.stringify({
      name: 'n', pids: [{ pid: -1, pid_start: 'x' }]
    }));
    expect(response.status).toBe(400);
  });

  it('is idempotent on name', async () => {
    const body = JSON.stringify({ name: 'idem-test', pids: [{ pid: 1, pid_start: 's' }] });
    const first = await callPost(body);
    const second = await callPost(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstPayload = await first.json();
    const secondPayload = await second.json();
    expect(secondPayload.terminal_id).toBe(firstPayload.terminal_id);
  });

  // ACTIVATION (Simplify & Harden lane A): register populates the durable
  // ant_sessions layer (was 0/dormant on live) + returns the session id.
  it('register POPULATES a durable session and returns session_id', async () => {
    const response = await callPost(JSON.stringify({
      name: 'activate-test', pids: [{ pid: 4242, pid_start: 's' }], source: 'test',
      handle: '@activate'
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.session_id).toBeTruthy();
    expect(payload.session_id).not.toBe(payload.terminal_id);
    // the durable session actually exists (no longer dormant)
    const session = getSession(payload.session_id);
    expect(session).not.toBeNull();
    expect(session!.kind).toBe('local-cli');
    expect(session!.label).toBe('@activate');
  });

  it('re-register with the returned secret token resolves the SAME durable session', async () => {
    const body = JSON.stringify({ name: 'stable-test', handle: '@stable', pids: [{ pid: 1, pid_start: 'a' }] });
    const first = await (await callPost(body)).json();
    // re-register with a DIFFERENT pid_start (the day-roll/restart that used to 403)
    const restart = JSON.stringify({
      name: 'stable-test',
      handle: '@stable',
      pids: [{ pid: 1, pid_start: 'DIFFERENT' }],
      sessionToken: first.session_id
    });
    const second = await (await callPost(restart)).json();
    expect(second.session_id).toBe(first.session_id); // same identity across pid change
  });

  it('honours a client sessionToken from its OWN terminal (binds + reuses)', async () => {
    const tok = 'client-persisted-token-xyz';
    const a1 = await callPost(JSON.stringify({ name: 'tok-own', pids: [{ pid: 1, pid_start: 'a' }], sessionToken: tok }));
    expect(a1.status).toBe(201);
    expect((await a1.json()).session_id).toBe(tok);
    // same terminal (same name), restart pid -> reuses the bound session
    const a2 = await callPost(JSON.stringify({ name: 'tok-own', pids: [{ pid: 9, pid_start: 'z' }], sessionToken: tok }));
    expect((await a2.json()).session_id).toBe(tok);
  });

  it('REFUSES a client sessionToken reused from a DIFFERENT terminal (anti-adoption, @v4claude #149 vector)', async () => {
    const tok = 'victim-token';
    const victim = await callPost(JSON.stringify({ name: 'victim', pids: [{ pid: 1, pid_start: 'a' }], sessionToken: tok }));
    expect(victim.status).toBe(201);
    // attacker on a DIFFERENT terminal presents the known token -> 409, no adoption
    const attacker = await callPost(JSON.stringify({ name: 'attacker', pids: [{ pid: 2, pid_start: 'b' }], sessionToken: tok }));
    expect(attacker.status).toBe(409);
  });

  it('backfills room handle leases from existing memberships when register activates a durable session', async () => {
    const existing = upsertTerminal({
      name: 'lease-backfill',
      pid: 11,
      pid_start: 'same',
      ttlSeconds: 3600,
      source: 'test',
      meta: {}
    });
    addMembership({
      room_id: 'room-existing-membership',
      handle: '@leasebackfill',
      terminal_id: existing.id
    });

    const response = await callPost(JSON.stringify({
      name: 'lease-backfill',
      pids: [{ pid: 11, pid_start: 'same' }],
      handle: '@leasebackfill'
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    const lease = findRoomHandleOwnerAtTime({
      roomId: 'room-existing-membership',
      handle: '@leasebackfill',
      atMs: Date.now()
    });
    expect(lease).not.toBeNull();
    expect(lease?.sessionId).toBe(payload.session_id);
    expect(lease?.createdFrom).toBe('register-existing-membership-backfill');
  });

  // M3.2d: client-input agent_kind validation rejects unknown/remote/browser/bogus.
  for (const bad of ['unknown', 'remote', 'browser', 'bogus']) {
    it(`rejects agent_kind="${bad}" with 400`, async () => {
      const response = await callPost(JSON.stringify({
        name: `bad-${bad}`, pids: [{ pid: 1, pid_start: 's' }], pane: '%1', agent_kind: bad
      }));
      expect(response.status).toBe(400);
      expect(getTerminalByName(`bad-${bad}`)).toBeNull();
    });
  }
  it('accepts agent_kind="claude_code" (canonical client-input value)', async () => {
    const response = await callPost(JSON.stringify({
      name: 'good-cc', pids: [{ pid: 1, pid_start: 's' }], pane: '%1', agent_kind: 'claude_code'
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).agent_kind).toBe('claude_code');
  });

  // M3.2b: auto-classify-on-create (INSERT-new + omitted kind + pane).
  it('M3.2b a: INSERT-new + omitted agent_kind + pane → may classify (best-effort)', async () => {
    const response = await callPost(JSON.stringify({
      name: 'classify-on-create', pids: [{ pid: 1, pid_start: 's' }], pane: '%1'
    }));
    expect(response.status).toBe(201);
    // Detection runs against real tmux; result may be HIGH/MED/LOW or null.
    // We only assert the call succeeded and the row was written.
    expect(getTerminalByName('classify-on-create')).not.toBeNull();
  });

  it('M3.2b b: INSERT-new + supplied agent_kind → does NOT auto-classify (caller wins)', async () => {
    const response = await callPost(JSON.stringify({
      name: 'caller-wins', pids: [{ pid: 1, pid_start: 's' }], pane: '%1', agent_kind: 'cursor'
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).agent_kind).toBe('cursor');
  });

  it('M3.2b c: INSERT-new + omitted agent_kind + NO pane → does NOT classify', async () => {
    const response = await callPost(JSON.stringify({
      name: 'no-pane', pids: [{ pid: 1, pid_start: 's' }]
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).agent_kind).toBeNull();
  });

  it('M3.2b d: same-name re-register + omitted kind + pane → classify NOT called + existing kind preserved (B1 + path B)', async () => {
    // First: register with explicit agent_kind so the row has aider on disk.
    const first = await callPost(JSON.stringify({
      name: 're-register', pids: [{ pid: 1, pid_start: 's' }], pane: '%1', agent_kind: 'aider'
    }));
    expect(first.status).toBe(201);
    expect((await first.json()).agent_kind).toBe('aider');
    // Re-register without agent_kind: existed=true short-circuits classify
    // AND path B preserves existing kind through updatePaneTarget.
    // Phase A2 lifecycle rule: same (pid, pid_start) keeps this idempotent;
    // a different PID under a live name would now 409 (Phase A2 case (a)).
    // Pane changes from %1 → %2 still exercises updatePaneTarget.
    const second = await callPost(JSON.stringify({
      name: 're-register', pids: [{ pid: 1, pid_start: 's' }], pane: '%2'
    }));
    expect(second.status).toBe(201);
    expect((await second.json()).agent_kind).toBe('aider'); // delta-5 R2 lock
    const stored = getTerminalByName('re-register');
    expect(stored?.agent_kind).toBe('aider');
    const meta = JSON.parse(stored?.meta ?? '{}');
    expect(meta.fingerprint_evidence_hash).toBeUndefined();
  });

  it('M3.2b e: classify-throw isolation → 201 still returned', async () => {
    // No mock of detector; this just proves the try/catch wraps the call so
    // the 201 path doesn't throw even when classify is called.
    const response = await callPost(JSON.stringify({
      name: 'isolation-test', pids: [{ pid: 99999, pid_start: 's' }], pane: '%1'
    }));
    expect(response.status).toBe(201);
  });

  // Phase A2 (JWPK A Team msg_7uvr35x0xr 2026-05-29, design Q2 default B —
  // helpful 409 messages with the conflicting terminal id/name + the
  // explicit recovery action). The four cases below cover the contract:
  //   (a) live-name conflict with a different PID → 409;
  //   (b) PID-in-use under a different live name → 409;
  //   (c) same (name, pid, pid_start) re-register stays idempotent;
  //   (d) name that exists but is archived can be reused.
  it('Phase A2 (a): 409 when a live name re-registers from a different PID without the durable token', async () => {
    const first = await callPost(JSON.stringify({
      name: 'conflict-live', pids: [{ pid: 1111, pid_start: 's-orig' }]
    }));
    expect(first.status).toBe(201);
    const second = await callPost(JSON.stringify({
      name: 'conflict-live', pids: [{ pid: 2222, pid_start: 's-new' }]
    }));
    expect(second.status).toBe(409);
    const payload = await second.json().catch(() => ({}));
    expect(String(payload?.message ?? '')).toContain("Name 'conflict-live' is already live");
  });

  it('Phase A2 (b): 409 when PID is already bound to a different live terminal', async () => {
    const first = await callPost(JSON.stringify({
      name: 'first-owner', pids: [{ pid: 3333, pid_start: 's-shared' }]
    }));
    expect(first.status).toBe(201);
    const second = await callPost(JSON.stringify({
      name: 'second-owner', pids: [{ pid: 3333, pid_start: 's-shared' }]
    }));
    expect(second.status).toBe(409);
    const payload = await second.json().catch(() => ({}));
    const msg = String(payload?.message ?? '');
    expect(msg).toContain('PID 3333');
    expect(msg).toContain("already bound to live terminal 'first-owner'");
    expect(msg).toMatch(/Archive it first/);
    expect(getTerminalByName('second-owner')).toBeNull();
  });

  it('Phase A2 (c): same name + same (pid, pid_start) re-register stays idempotent', async () => {
    const body = JSON.stringify({
      name: 'idem-A2', pids: [{ pid: 4444, pid_start: 's-same' }]
    });
    const first = await callPost(body);
    const second = await callPost(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await second.json()).terminal_id).toBe((await first.json()).terminal_id);
  });

  it('Phase A2 (d): name that exists but is archived can be reused', async () => {
    const first = await callPost(JSON.stringify({
      name: 'recycle-name', pids: [{ pid: 5555, pid_start: 's-old' }]
    }));
    expect(first.status).toBe(201);
    const firstId = (await first.json()).terminal_id as string;
    expect(setTerminalStatus(firstId, 'archived')).toBe(true);
    const second = await callPost(JSON.stringify({
      name: 'recycle-name', pids: [{ pid: 6666, pid_start: 's-new' }], fresh: true
    }));
    expect(second.status).toBe(201);
    const stored = getTerminalByName('recycle-name');
    expect(stored?.pid).toBe(6666);
  });

  // Lifecycle Phase B (JWPK A Team msg_7uvr35x0xr 2026-05-29 Q4 default).
  // The register endpoint does NOT create terminal_records rows itself —
  // that's POST /api/terminals' job. So these tests seed a record keyed
  // by the same session_id as the registered terminal, then re-register
  // with a different handle and assert the alias trail.
  describe('Phase B — handle_aliases on handle change', () => {
    async function registerAndSeed(name: string, handle: string | null): Promise<string> {
      const response = await callPost(JSON.stringify({
        name, pids: [{ pid: 1, pid_start: 's' }], handle: handle ?? undefined
      }));
      expect(response.status).toBe(201);
      const { terminal_id } = await response.json();
      // Seed a terminal_records row keyed by the same session_id so the
      // register endpoint sees an "existing terminal_records row" on the
      // next call. (Production flow: POST /api/terminals does this.)
      // Skip if already seeded (re-register paths call this twice).
      if (!getTerminalRecord(terminal_id)) {
        createTerminalRecord({ sessionId: terminal_id, name, handle });
      }
      return terminal_id;
    }

    it('first register with handle @claudev4 — handle_aliases is empty (no prior)', async () => {
      const sessionId = await registerAndSeed('phase-b-first', '@claudev4');
      expect(getHandleAliases(sessionId)).toEqual([]);
      expect(getTerminalRecord(sessionId)?.handle).toBe('@claudev4');
    });

    it('re-register with @claudev5 — new becomes primary, @claudev4 in aliases', async () => {
      const sessionId = await registerAndSeed('phase-b-morph', '@claudev4');
      const second = await callPost(JSON.stringify({
        name: 'phase-b-morph', pids: [{ pid: 1, pid_start: 's' }], handle: '@claudev5'
      }));
      expect(second.status).toBe(201);
      expect(getTerminalRecord(sessionId)?.handle).toBe('@claudev5');
      expect(getHandleAliases(sessionId)).toEqual(['@claudev4']);
    });

    it('re-register again with @claudev6 — aliases is [@claudev4, @claudev5] (append, not replace)', async () => {
      const sessionId = await registerAndSeed('phase-b-chain', '@claudev4');
      await callPost(JSON.stringify({
        name: 'phase-b-chain', pids: [{ pid: 1, pid_start: 's' }], handle: '@claudev5'
      }));
      const third = await callPost(JSON.stringify({
        name: 'phase-b-chain', pids: [{ pid: 1, pid_start: 's' }], handle: '@claudev6'
      }));
      expect(third.status).toBe(201);
      expect(getTerminalRecord(sessionId)?.handle).toBe('@claudev6');
      expect(getHandleAliases(sessionId)).toEqual(['@claudev4', '@claudev5']);
    });

    it('re-register with the SAME handle — aliases unchanged (no dup-append)', async () => {
      const sessionId = await registerAndSeed('phase-b-noop', '@claudev6');
      // First handle change to seed an alias entry.
      await callPost(JSON.stringify({
        name: 'phase-b-noop', pids: [{ pid: 1, pid_start: 's' }], handle: '@claudev7'
      }));
      expect(getHandleAliases(sessionId)).toEqual(['@claudev6']);
      // Re-register with the SAME @claudev7 — no append.
      const noop = await callPost(JSON.stringify({
        name: 'phase-b-noop', pids: [{ pid: 1, pid_start: 's' }], handle: '@claudev7'
      }));
      expect(noop.status).toBe(201);
      expect(getHandleAliases(sessionId)).toEqual(['@claudev6']);
      expect(getTerminalRecord(sessionId)?.handle).toBe('@claudev7');
    });

    it('re-register with no handle field — handle stays, no alias appended', async () => {
      const sessionId = await registerAndSeed('phase-b-omit', '@claudev4');
      const response = await callPost(JSON.stringify({
        name: 'phase-b-omit', pids: [{ pid: 1, pid_start: 's' }]
        // no handle field
      }));
      expect(response.status).toBe(201);
      expect(getTerminalRecord(sessionId)?.handle).toBe('@claudev4');
      expect(getHandleAliases(sessionId)).toEqual([]);
    });
  });

  // PR-B v0.2 (JWPK enterprise-concern #5 — @speedyc dual-bind 2026-05-29).
  // Auto-rebind: when a fresh `ant register` lands a NEW terminal_record
  // for an existing handle whose old terminal binding is stale, the
  // endpoint moves every room_memberships row from old → new terminal_id,
  // archives the old terminal, and supersedes the old terminal_records
  // row. NEVER fires when the old terminal is genuinely alive.
  describe('PR-B v0.2 — auto-rebind on register when stale binding exists', () => {
    function seedOldTerminalForHandle(input: {
      handle: string;
      name: string;
      pid: number;
      heartbeatMs: number | null;
    }): { oldTerminalId: string; roomIds: string[] } {
      const old = upsertTerminal({
        pid: input.pid,
        pid_start: 'pst-old',
        name: input.name
      });
      createTerminalRecord({
        sessionId: old.id,
        name: input.name,
        handle: input.handle
      });
      // Backdate (or freshen) the heartbeat via direct DB write — the
      // terminalsStore helpers only stamp "now", so for stale-test cases
      // we need to set last_message_sent_at_ms to a fixed past value.
      if (input.heartbeatMs !== null) {
        const db = getIdentityDb();
        db.prepare(
          `UPDATE terminals SET last_message_sent_at_ms = ?, last_pty_byte_at_ms = ?
            WHERE id = ?`
        ).run(input.heartbeatMs, input.heartbeatMs, old.id);
      }
      const roomIds = ['room-rebind-A', 'room-rebind-B', 'room-rebind-C'];
      for (const roomId of roomIds) {
        addMembership({ room_id: roomId, handle: input.handle, terminal_id: old.id });
      }
      return { oldTerminalId: old.id, roomIds };
    }

    it('moves room_memberships from stale old terminal → fresh new terminal', async () => {
      // Stage: old terminal bound to @speedyc with heartbeat 10min ago.
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const { oldTerminalId, roomIds } = seedOldTerminalForHandle({
        handle: '@speedyc',
        name: 'speedyclaude-freshstart',
        pid: 1111,
        heartbeatMs: tenMinutesAgo
      });
      // Fresh register — new name, new PID, SAME handle.
      const response = await callPost(JSON.stringify({
        name: 'SpeedyC',
        pids: [{ pid: 2222, pid_start: 'pst-new' }],
        handle: '@speedyc'
      }));
      expect(response.status).toBe(201);
      const { terminal_id: newTerminalId } = await response.json();
      expect(newTerminalId).not.toBe(oldTerminalId);
      // All 3 memberships re-pointed to the new terminal.
      for (const roomId of roomIds) {
        const rows = listMembershipsForRoom(roomId);
        const speedyc = rows.find((r) => r.handle === '@speedyc');
        expect(speedyc?.terminal_id).toBe(newTerminalId);
      }
      // Old terminal flipped to archived.
      expect(getTerminalById(oldTerminalId)?.status).toBe('archived');
      // Old terminal_records row marked superseded.
      const oldRecord = getTerminalRecord(oldTerminalId);
      expect(oldRecord?.superseded_at_ms).not.toBeNull();
    });

    it('Option A: suffixes (not steals) when old terminal heartbeat is fresh — no-hijack preserved (2026-06-04)', async () => {
      // Pre sec-iter1: register returned 201 but SHARED the handle with the
      // fresh owner (privilege-escalation surface). sec-iter1 closed that with
      // a 409. Option A (2026-06-04) keeps the no-hijack guarantee WITHOUT the
      // mute: a live incumbent keeps clean @alivec + all its memberships; the
      // new caller is suffixed to @alivec-1 and still gets a token. The
      // auto-rebind path still reclaims clean when the prior owner is stale.
      const thirtySecondsAgo = Date.now() - 30 * 1000;
      const { oldTerminalId, roomIds } = seedOldTerminalForHandle({
        handle: '@alivec',
        name: 'alivec-original',
        pid: 3333,
        heartbeatMs: thirtySecondsAgo
      });
      const response = await callPost(JSON.stringify({
        name: 'AliveC-rebind-attempt',
        pids: [{ pid: 4444, pid_start: 'pst-new' }],
        handle: '@alivec'
      }));
      // Not mute: 201 + token, but the caller is SUFFIXED, not granted @alivec.
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(typeof body.session_id).toBe('string');
      expect(getSession(body.session_id)?.label).toBe('@alivec-1');
      // NO-HIJACK: memberships still bound to the original live owner.
      for (const roomId of roomIds) {
        const rows = listMembershipsForRoom(roomId);
        const alivec = rows.find((r) => r.handle === '@alivec');
        expect(alivec?.terminal_id).toBe(oldTerminalId);
      }
      // Old terminal still live, not archived.
      expect(getTerminalById(oldTerminalId)?.status).toBe('live');
      // Old terminal_records row NOT superseded.
      expect(getTerminalRecord(oldTerminalId)?.superseded_at_ms).toBeNull();
    });

    it('rebinds when old terminal has never emitted a heartbeat (latest=0)', async () => {
      // A terminal seeded by the daemon spawn path but never touched by
      // the agent. heartbeatMs = null leaves last_message_sent_at_ms = NULL.
      const { oldTerminalId, roomIds } = seedOldTerminalForHandle({
        handle: '@dormant',
        name: 'dormant-original',
        pid: 5555,
        heartbeatMs: null
      });
      const response = await callPost(JSON.stringify({
        name: 'DormantC-fresh',
        pids: [{ pid: 6666, pid_start: 'pst-new' }],
        handle: '@dormant'
      }));
      expect(response.status).toBe(201);
      const { terminal_id: newTerminalId } = await response.json();
      // Memberships re-pointed.
      for (const roomId of roomIds) {
        const rows = listMembershipsForRoom(roomId);
        expect(rows.find((r) => r.handle === '@dormant')?.terminal_id).toBe(newTerminalId);
      }
      expect(getTerminalById(oldTerminalId)?.status).toBe('archived');
    });

    it('no-op when there is no prior terminal binding for the handle', async () => {
      // Pure first-time register — no existing rows for @brandnew.
      const response = await callPost(JSON.stringify({
        name: 'BrandNew',
        pids: [{ pid: 7777, pid_start: 'pst-new' }],
        handle: '@brandnew'
      }));
      expect(response.status).toBe(201);
      const { terminal_id } = await response.json();
      // Sanity: the new terminal is the only live one for @brandnew.
      // No assertions on archive/supersede — there's nothing to archive.
      expect(getTerminalById(terminal_id)?.status).toBe('live');
    });

    it('skips self when caller and existing live binding are the same terminal_id', async () => {
      // Same name + same PID re-register: upsertTerminal returns the
      // existing terminal_id, so the auto-rebind loop sees itself in
      // liveCandidates and must skip rather than try to steal from itself.
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const { oldTerminalId, roomIds } = seedOldTerminalForHandle({
        handle: '@selfc',
        name: 'selfc-original',
        pid: 8888,
        heartbeatMs: tenMinutesAgo
      });
      const response = await callPost(JSON.stringify({
        name: 'selfc-original',
        pids: [{ pid: 8888, pid_start: 'pst-old' }],
        handle: '@selfc'
      }));
      expect(response.status).toBe(201);
      const { terminal_id } = await response.json();
      // Idempotent re-register — same terminal_id, memberships still
      // point at it, terminal still live (auto-rebind skipped self).
      expect(terminal_id).toBe(oldTerminalId);
      for (const roomId of roomIds) {
        const rows = listMembershipsForRoom(roomId);
        expect(rows.find((r) => r.handle === '@selfc')?.terminal_id).toBe(oldTerminalId);
      }
      expect(getTerminalById(oldTerminalId)?.status).toBe('live');
      expect(getTerminalRecord(oldTerminalId)?.superseded_at_ms).toBeNull();
    });
  });

  describe('v0.2 removal — register does not run the sidecar in prod', () => {
    it('returns null v0.2 fields and creates no v0.2 agent/runtime/audit rows', async () => {
      const response = await callPost(JSON.stringify({
        name: 'no-v02-sidecar',
        handle: '@no-v02-sidecar',
        pids: [{ pid: 7777, pid_start: 'Tue May 13 00:00:00 2026' }],
        pane: '%9',
        agent_kind: 'claude_code'
      }));
      expect(response.status).toBe(201);
      const payload = await response.json();
      expect(payload.v02_agent_id).toBeNull();
      expect(payload.v02_runtime_id).toBeNull();
      const db = getIdentityDb();
      expect((db.prepare(`SELECT COUNT(*) AS n FROM agents`).get() as { n: number }).n).toBe(0);
      expect((db.prepare(`SELECT COUNT(*) AS n FROM runtimes`).get() as { n: number }).n).toBe(0);
      expect((db.prepare(`SELECT COUNT(*) AS n FROM audit_events`).get() as { n: number }).n).toBe(0);
    });

    it('does not tag terminal meta as v0.2 bridged', async () => {
      await callPost(JSON.stringify({
        name: 'plain-meta',
        pids: [{ pid: 5, pid_start: 's' }]
      }));
      const stored = getTerminalByName('plain-meta');
      const meta = JSON.parse(stored?.meta ?? '{}');
      expect(meta['v0.2_bridged']).toBeUndefined();
    });

    it('preserves caller-supplied meta fields without adding v0.2 provenance', async () => {
      await callPost(JSON.stringify({
        name: 'meta-passthrough',
        pids: [{ pid: 6, pid_start: 's' }],
        meta: { existing_field: 'should-survive', nested: { ok: true } }
      }));
      const stored = getTerminalByName('meta-passthrough');
      const meta = JSON.parse(stored?.meta ?? '{}');
      expect(meta['v0.2_bridged']).toBeUndefined();
      expect(meta.existing_field).toBe('should-survive');
      expect(meta.nested).toEqual({ ok: true });
    });

    it('idempotent on name: second call with same PID still returns null v0.2 fields', async () => {
      const first = await callPost(JSON.stringify({
        name: 'no-v02-idem',
        pids: [{ pid: 4, pid_start: 's' }]
      }));
      const second = await callPost(JSON.stringify({
        name: 'no-v02-idem',
        pids: [{ pid: 4, pid_start: 's' }]
      }));
      const secondPayload = await second.json();
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(secondPayload.v02_agent_id).toBeNull();
      expect(secondPayload.v02_runtime_id).toBeNull();
    });
  });

  // sec-iter1 Fix #2 (handle uniqueness root cause) + Fix #3 (M13
  // reserved-list enforcement). Cover the new 400 + 409 surfaces.
  describe('sec-iter1: handle validation + uniqueness', () => {
    it('rejects reserved handle with 400', async () => {
      // `@you` is in the reserved list. Validator returns 400 before
      // any side-effects so no terminal row is created.
      const response = await callPost(JSON.stringify({
        name: 'reserved-name',
        handle: '@you',
        pids: [{ pid: 100, pid_start: 's' }]
      }));
      expect(response.status).toBe(400);
      expect(getTerminalByName('reserved-name')).toBeNull();
    });

    it('rejects reserved handle case-insensitively', async () => {
      const response = await callPost(JSON.stringify({
        name: 'reserved-mixed-case',
        handle: '@Admin',
        pids: [{ pid: 101, pid_start: 's' }]
      }));
      expect(response.status).toBe(400);
    });

    it('rejects handle containing spaces with 400', async () => {
      const response = await callPost(JSON.stringify({
        name: 'space-name',
        handle: '@bad name',
        pids: [{ pid: 102, pid_start: 's' }]
      }));
      expect(response.status).toBe(400);
    });

    it('rejects 65-char handle with 400 (too long)', async () => {
      const long = '@' + 'a'.repeat(65);
      const response = await callPost(JSON.stringify({
        name: 'too-long',
        handle: long,
        pids: [{ pid: 103, pid_start: 's' }]
      }));
      expect(response.status).toBe(400);
    });

    it('accepts a valid non-reserved handle', async () => {
      const response = await callPost(JSON.stringify({
        name: 'valid-handle',
        handle: '@speedyc',
        pids: [{ pid: 104, pid_start: 's' }]
      }));
      expect(response.status).toBe(201);
    });

    it('rejects ANY register of the server handle with 400 via the reserved gate (no idempotent allow-path)', async () => {
      // The operator handle is rejected by validateHandleForRegistration as
      // `reserved` BEFORE handleValue is set, so the route never reaches an
      // operator-specific branch — there is deliberately NO idempotent
      // operator-reregister allow-block (dropped as dead code 2026-06-10,
      // @c4/@speedy review). Assert the REASON, not just the 400, so this test
      // documents WHICH gate fires: the reserved/operator-handle reject.
      const response = await callPost(JSON.stringify({
        name: 'fake-jwpk',
        handle: '@JWPK',
        pids: [{ pid: 105, pid_start: 's' }]
      }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toMatch(/operator handle/i);
      expect(getTerminalByName('fake-jwpk')).toBeNull();
    });

    it('Option A: live-handle collision -> 201 + suffixed @x-N, clean @x untouched (supersedes the old 409, 2026-06-04)', async () => {
      // Pre-2026-06-04 this path threw 409 — but it rejected BEFORE the session
      // token + lease were minted, so the caller walked away TOKENLESS = mute
      // (the bug hand-repaired five times). Option A keeps the live incumbent's
      // clean handle and grants the new caller the lowest-free @x-N suffix PLUS
      // a real token, so it can post under a distinct, visible identity.
      const setup = upsertTerminal({
        pid: 7001,
        pid_start: 'pst-fresh',
        name: 'fresh-owner'
      });
      createTerminalRecord({
        sessionId: setup.id,
        name: 'fresh-owner',
        handle: '@uniq-owner'
      });
      const nowMs = Date.now();
      const db = getIdentityDb();
      db.prepare(
        `UPDATE terminals SET last_message_sent_at_ms = ?, last_pty_byte_at_ms = ? WHERE id = ?`
      ).run(nowMs, nowMs, setup.id);

      // A different LIVE terminal registers under the same handle.
      const response = await callPost(JSON.stringify({
        name: 'attacker-pane',
        handle: '@uniq-owner',
        pids: [{ pid: 7002, pid_start: 'pst-attacker' }]
      }));

      // (1) NEVER MUTE: 201 + a real session token is returned.
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(typeof body.session_id).toBe('string');
      expect(body.session_id.length).toBeGreaterThan(0);

      // (2) the caller is SUFFIXED, not granted clean @uniq-owner. (register
      // does not create a terminal_record, so the granted handle lives on the
      // durable session label.)
      const callerSession = getSession(body.session_id);
      expect(callerSession?.label).toBe('@uniq-owner-1');

      // (3) NO-HIJACK: the live incumbent's terminal_record is byte-unchanged —
      // it still owns clean @uniq-owner on its own session.
      const incumbent = getTerminalRecord(setup.id);
      expect(incumbent?.handle).toBe('@uniq-owner');
      expect(incumbent?.session_id).toBe(setup.id);
    });

    it('still allows auto-rebind when the existing claimant is STALE', async () => {
      // Same shape as the 409 test BUT the existing claimant's
      // heartbeat is 10 min in the past — auto-rebind exemption fires
      // and the new register succeeds (covered also by the PR-B tests;
      // this asserts our Fix #2 didn't break that path).
      const setup = upsertTerminal({
        pid: 7100,
        pid_start: 'pst-stale',
        name: 'stale-owner'
      });
      createTerminalRecord({
        sessionId: setup.id,
        name: 'stale-owner',
        handle: '@stale-rebind'
      });
      const tenMinAgo = Date.now() - 10 * 60 * 1000;
      const db = getIdentityDb();
      db.prepare(
        `UPDATE terminals SET last_message_sent_at_ms = ?, last_pty_byte_at_ms = ? WHERE id = ?`
      ).run(tenMinAgo, tenMinAgo, setup.id);

      const response = await callPost(JSON.stringify({
        name: 'fresh-rebinder',
        handle: '@stale-rebind',
        pids: [{ pid: 7101, pid_start: 'pst-new' }]
      }));
      expect(response.status).toBe(201);
    });
  });

  // PART 2 (register-writes-real-token, 2026-06-04): register re-keys the CLEAN
  // singular room_handle_lease (the table the POST-gate actually reads) to the
  // caller's real token for its EXISTING memberships, so an invite-room agent
  // whose lease was minted under a now-dead terminal-id is no longer mute —
  // closing the 5×-hand-repaired recurrence in code.
  describe('Part 2: clean-lease self-heal for existing memberships', () => {
    it('re-keys a dead-terminal-id clean lease to the real token on register (invite-room mute fix)', async () => {
      const roomId = 'invite-room-pt2';
      const handle = '@partytwo';
      // The agent is already a member (clean membership), but its clean lease in
      // this room is keyed to a DEAD terminal-id — no ant_session resolves it.
      // This is exactly the antOS shape that needed a manual fix.
      const deadTerminalKey = 't_deadkey_zzz';
      addMember(roomId, handle, deadTerminalKey);
      claimCleanHandle(roomId, handle, deadTerminalKey);
      // Pre-condition: the gate sees the dead key as the clean holder.
      expect(resolveCleanMember(roomId, handle)).toBe(deadTerminalKey);

      // The real agent registers with its handle and a live pidChain.
      const response = await callPost(JSON.stringify({
        name: 'partytwo-shell',
        handle,
        pids: [{ pid: 9001, pid_start: 'pst-pt2' }]
      }));
      expect(response.status).toBe(201);
      const body = await response.json();
      const realToken = body.session_id as string;
      expect(typeof realToken).toBe('string');

      // Self-heal: the clean holder the gate reads is now the REAL token …
      expect(resolveCleanMember(roomId, handle)).toBe(realToken);
      expect(isCleanMember(roomId, realToken)).toBe(true);
      // … and the canonical membership row follows the same durable token.
      // Without this, the roster/proof path says one session owns @handle
      // while the post-gate lease says another session owns it.
      expect(resolveMembershipMember(roomId, handle)).toBe(realToken);
      // … and the dead terminal-id lease has been retired (no longer a member).
      expect(isCleanMember(roomId, deadTerminalKey)).toBe(false);
    });

    it('does NOT steal clean @x from a genuinely-live different session (no-hijack)', async () => {
      const roomId = 'invite-room-pt2-live';
      const handle = '@livehold';
      // A genuinely-live session holds clean @livehold: real ant_session bound to
      // a fresh (live) terminal.
      const liveOwner = upsertTerminal({ pid: 8201, pid_start: 'pst-live', name: 'livehold-owner' });
      const now = Date.now();
      const db = getIdentityDb();
      db.prepare(
        `UPDATE terminals SET last_message_sent_at_ms = ?, last_pty_byte_at_ms = ? WHERE id = ?`
      ).run(now, now, liveOwner.id);
      // Bind a durable session to that terminal and let it hold clean @livehold.
      // (ensureSession via a register call gives us a real token bound to the
      // live terminal.)
      const ownerResp = await callPost(JSON.stringify({
        name: 'livehold-owner',
        handle,
        pids: [{ pid: 8201, pid_start: 'pst-live' }]
      }));
      const ownerToken = (await ownerResp.json()).session_id as string;
      addMember(roomId, handle, ownerToken);
      claimCleanHandle(roomId, handle, ownerToken);
      expect(resolveCleanMember(roomId, handle)).toBe(ownerToken);

      // A DIFFERENT shell registers the same handle. Part 1 suffixes it to
      // @livehold-1 (live incumbent terminal_record holds @livehold), so Part 2
      // runs for @livehold-1 — which has no memberships — and never touches the
      // live owner's clean @livehold lease.
      const intruderResp = await callPost(JSON.stringify({
        name: 'livehold-intruder',
        handle,
        pids: [{ pid: 8202, pid_start: 'pst-intruder' }]
      }));
      expect(intruderResp.status).toBe(201);
      const intruderToken = (await intruderResp.json()).session_id as string;

      // No-hijack: the live owner still wears clean @livehold; the intruder did
      // not become a clean member of the room.
      expect(resolveCleanMember(roomId, handle)).toBe(ownerToken);
      expect(isCleanMember(roomId, intruderToken)).toBe(false);
    });
  });

  describe('clean-core dual-write (AC3 Step 1)', () => {
    beforeEach(() => {
      // Corroboration gate (third-adopter slice): pane %77 genuinely hosts
      // the registering caller's pid in this fixture.
      setListPanePidsForTests(() => ({ status: 0, stdout: '%77 4242\n', stderr: '' }));
    });
    afterEach(() => setListPanePidsForTests(null));

    it('register with handle + pane dual-writes a live handle binding and a non-vacant handles row', async () => {
      const response = await POST(eventForPost(JSON.stringify({
        name: 'BindingDualWrite',
        pids: [{ pid: 4242, pid_start: '2026-06-10T20:00:00Z' }],
        pane: '%77',
        handle: '@bindme',
        agent_kind: 'claude_code'
      })));
      expect(response.status).toBe(201);
      const binding = getLiveBinding('@bindme');
      expect(binding?.pane).toBe('%77');
      expect(binding?.pid).toBe(4242);
      expect(getHandleRow('@bindme')?.vacated_at_ms).toBeNull();
    });

    it('register without a pane writes no binding (nothing witnessed)', async () => {
      const response = await POST(eventForPost(JSON.stringify({
        name: 'NoPaneNoBinding',
        pids: [{ pid: 4243, pid_start: '2026-06-10T20:00:01Z' }],
        handle: '@paneless'
      })));
      expect(response.status).toBe(201);
      expect(getLiveBinding('@paneless')).toBeNull();
    });
  });

  describe('register on the seam (third adopter — AC3 outcome shadow)', () => {
    const prevMode = process.env.ANT_IDENTITY_READ;

    beforeEach(() => { delete process.env.ANT_IDENTITY_READ; });

    afterEach(() => {
      if (prevMode === undefined) delete process.env.ANT_IDENTITY_READ;
      else process.env.ANT_IDENTITY_READ = prevMode;
      setListPanePidsForTests(null);
    });

    function corroborate(pane: string, pid: number) {
      setListPanePidsForTests(() => ({ status: 0, stdout: `${pane} ${pid}\n`, stderr: '' }));
    }

    it('uncorroborated pane writes NO binding in ANY mode and ledgers the spoof signature; registration still 201', async () => {
      // pane exists but hosts a different process tree
      setListPanePidsForTests(() => ({ status: 0, stdout: '%88 1\n', stderr: '' }));
      const response = await POST(eventForPost(JSON.stringify({
        name: 'UncorroboratedReg', pids: [{ pid: 5101, pid_start: 'reg-uncorr' }],
        pane: '%88', handle: '@uncorr'
      })));
      expect(response.status).toBe(201);
      expect(getLiveBinding('@uncorr')).toBeNull();
      expect(listLedger({}).filter((e) => e.kind === 'pane.uncorroborated')).toHaveLength(1);
    });

    it('LEGACY: occupied-handle register suffixes exactly as before and writes no seam comparison rows', async () => {
      // live incumbent terminal holds @taken
      const incumbent = upsertTerminal({ pid: 5200, pid_start: 'reg-incumbent', name: 'IncumbentReg' });
      createTerminalRecord({ sessionId: incumbent.id, handle: '@taken' });
      corroborate('%90', 5201);
      const response = await POST(eventForPost(JSON.stringify({
        name: 'SuffixSeeker', pids: [{ pid: 5201, pid_start: 'reg-suffix' }],
        pane: '%90', handle: '@taken'
      })));
      expect(response.status).toBe(201);
      expect(listLedger({}).filter((e) => e.kind === 'resolver.disagreement')).toHaveLength(0);
    });

    it('SHADOW: free handle registers cleanly — no disagreement row, binding written', async () => {
      process.env.ANT_IDENTITY_READ = 'shadow';
      corroborate('%91', 5301);
      const response = await POST(eventForPost(JSON.stringify({
        name: 'FreeReg', pids: [{ pid: 5301, pid_start: 'reg-free' }],
        pane: '%91', handle: '@freshhandle'
      })));
      expect(response.status).toBe(201);
      expect(getLiveBinding('@freshhandle')?.pane).toBe('%91');
      expect(listLedger({}).filter((e) => e.kind === 'resolver.disagreement')).toHaveLength(0);
    });

    it('SHADOW: witness-occupied handle granted via the stale-inherit path ledgers the would-refuse divergence (behaviour unchanged)', async () => {
      process.env.ANT_IDENTITY_READ = 'shadow';
      // witness-occupied: a live binding holds @wanted on another pane
      bindHandle({ handle: '@wanted', pane: '%70', pid: 5400, pidStart: 'other', terminalId: 't_other' });
      // legacy-occupied too: live incumbent terminal_record
      const incumbent = upsertTerminal({ pid: 5400, pid_start: 'other', name: 'WantedIncumbent' });
      createTerminalRecord({ sessionId: incumbent.id, handle: '@wanted' });
      corroborate('%92', 5401);
      const response = await POST(eventForPost(JSON.stringify({
        name: 'WantedSeeker', pids: [{ pid: 5401, pid_start: 'reg-wanted' }],
        pane: '%92', handle: '@wanted'
      })));
      expect(response.status).toBe(201);
      const granted = (await response.json()) as { session_id: string };
      expect(granted).toBeTruthy();
      const rows = listLedger({}).filter((e) => e.kind === 'resolver.disagreement');
      expect(rows).toHaveLength(1);
      expect(rows[0].detail).toMatchObject({
        surface: 'register',
        requested_handle: '@wanted',
        contract_outcome: 'refuse'
      });
      // The incumbent terminal_record is heartbeat-stale, so legacy granted
      // the CLEAN handle through the silent stale-inherit path — the exact
      // register-by-handle spoof shape. The witness still showed a live
      // binding, so the contract verdict is refuse: divergence recorded.
      const grantedHandle = (rows[0].detail as { granted_handle?: string }).granted_handle;
      expect(grantedHandle).toBe('@wanted');
    });

    it('SHADOW: reclaiming a witness-vacant handle agrees with the contract — no divergence row', async () => {
      process.env.ANT_IDENTITY_READ = 'shadow';
      bindHandle({ handle: '@comeback', pane: '%71', pid: 5500, pidStart: 'old', terminalId: 't_old' });
      const { tombstoneBinding } = await import('$lib/server/handleBindingsStore');
      tombstoneBinding('@comeback', 'pane-not-found');
      corroborate('%93', 5501);
      const response = await POST(eventForPost(JSON.stringify({
        name: 'ComebackReg', pids: [{ pid: 5501, pid_start: 'reg-comeback' }],
        pane: '%93', handle: '@comeback'
      })));
      expect(response.status).toBe(201);
      expect(listLedger({}).filter((e) => e.kind === 'resolver.disagreement')).toHaveLength(0);
      expect(getLiveBinding('@comeback')?.pane).toBe('%93');
    });

    describe('CLEAN mode: refuse-or-claim (AC3, the cutover behaviour)', () => {
      beforeEach(() => { process.env.ANT_IDENTITY_READ = 'clean'; });

      it('occupied handle (live witnessed binding on another pane) → 403 handle_occupied, nothing inherited, ledgered + owner notified', async () => {
        bindHandle({ handle: '@taken-clean', pane: '%60', pid: 6100, pidStart: 'occ', terminalId: 't_occ' });
        getIdentityDb().prepare(`UPDATE handles SET owners = ? WHERE handle = ?`)
          .run(JSON.stringify(['@JWPK']), '@taken-clean');
        corroborate('%61', 6101);
        const response = await callPost(JSON.stringify({
          name: 'CleanIntruder', pids: [{ pid: 6101, pid_start: 'clean-intruder' }],
          pane: '%61', handle: '@taken-clean'
        }));
        expect(response.status).toBe(403);
        const payload = await response.json();
        expect(payload.permission_denied.reason).toBe('handle_occupied');
        expect(payload.permission_denied.approvers[0].handle).toBe('@JWPK');
        // the incumbent binding is untouched; no suffix terminal was minted under the handle
        expect(getLiveBinding('@taken-clean')?.pane).toBe('%60');
        const kinds = listLedger({ handle: '@taken-clean' }).map((e) => e.kind);
        expect(kinds).toContain('handle.claim-refused');
        expect(kinds).toContain('owner.notified');
      });

      it('vacant handle → instant claim, 201, binding witnessed on the new pane', async () => {
        bindHandle({ handle: '@vacant-clean', pane: '%62', pid: 6200, pidStart: 'old', terminalId: 't_old' });
        const { tombstoneBinding } = await import('$lib/server/handleBindingsStore');
        tombstoneBinding('@vacant-clean', 'pane-not-found');
        corroborate('%63', 6201);
        const response = await callPost(JSON.stringify({
          name: 'CleanReclaimer', pids: [{ pid: 6201, pid_start: 'clean-reclaim' }],
          pane: '%63', handle: '@vacant-clean'
        }));
        expect(response.status).toBe(201);
        expect(getLiveBinding('@vacant-clean')?.pane).toBe('%63');
      });

      it('own-pane re-register of an occupied handle is a reclaim of your own desk, not a collision', async () => {
        corroborate('%64', 6301);
        const first = await callPost(JSON.stringify({
          name: 'CleanSelf', pids: [{ pid: 6301, pid_start: 'clean-self' }],
          pane: '%64', handle: '@self-clean'
        }));
        expect(first.status).toBe(201);
        const again = await callPost(JSON.stringify({
          name: 'CleanSelf', pids: [{ pid: 6301, pid_start: 'clean-self' }],
          pane: '%64', handle: '@self-clean'
        }));
        expect(again.status).toBe(201);
      });

      it('free handle (never bound) → 201 with no refusal machinery touched', async () => {
        corroborate('%65', 6401);
        const response = await callPost(JSON.stringify({
          name: 'CleanFresh', pids: [{ pid: 6401, pid_start: 'clean-fresh' }],
          pane: '%65', handle: '@fresh-clean'
        }));
        expect(response.status).toBe(201);
        expect(listLedger({ handle: '@fresh-clean' }).map((e) => e.kind)).not.toContain('handle.claim-refused');
      });
    });

    describe('pane-witnessed self-ownership (cut-live exemption)', () => {
      it('re-register with drifted pid succeeds when the corroborated pane matches the existing terminal pane', async () => {
        // original registration binds the name to pane %70
        corroborate('%70', 7001);
        const first = await callPost(JSON.stringify({
          name: 'DriftedShell', pids: [{ pid: 7001, pid_start: 'orig' }],
          pane: '%70', handle: '@drifty'
        }));
        expect(first.status).toBe(201);
        // shell restarts: NEW pid, NO sessionToken — but same corroborated pane
        corroborate('%70', 7002);
        const again = await callPost(JSON.stringify({
          name: 'DriftedShell', pids: [{ pid: 7002, pid_start: 'restarted' }],
          pane: '%70', handle: '@drifty'
        }));
        expect(again.status).toBe(201);
      });

      it('a different pane claiming a live name without a token still 409s', async () => {
        corroborate('%71', 7101);
        const first = await callPost(JSON.stringify({
          name: 'HeldName', pids: [{ pid: 7101, pid_start: 'orig' }],
          pane: '%71', handle: '@holder'
        }));
        expect(first.status).toBe(201);
        corroborate('%72', 7201);
        const thief = await callPost(JSON.stringify({
          name: 'HeldName', pids: [{ pid: 7201, pid_start: 'thief' }],
          pane: '%72', handle: '@holder'
        }));
        expect(thief.status).toBe(409);
      });
    });

  });

});

// Register/redeem deadlock (fClaude, 2026-06-11): `ant register --handle` on a
// FRESH terminal must DECLARE the handle, or the terminal exists nameless —
// whoami returns registered-no-handle and redeem's "declared handle"
// precondition can never be met (circular). The morph block used to no-op when
// no terminal_records row existed (register "never creates records"); for a
// shell that never went through POST /api/terminals first, the handle landed
// nowhere. The clean-core binding is rightly corroboration-gated, so a desktop
// pane that the caller can't corroborate is the trigger case.
describe('POST /api/identity/register — fresh-terminal handle declaration', () => {
  afterEach(() => setListPanePidsForTests(null));

  it('declares the handle in terminal_records on a fresh terminal even when the pane is uncorroborated', async () => {
    // Desktop case: pane %35 is observably hosted by a pid NOT in the caller's
    // chain → corroboration fails → the clean-core binding is skipped.
    setListPanePidsForTests(() => ({ status: 0, stdout: '%35 99999\n', stderr: '' }));
    const response = await callPost(JSON.stringify({
      name: 'fable-cowork3',
      handle: '@fClaude',
      pane: '%35',
      pids: [{ pid: 4242, pid_start: 'Wed Jun 11 00:00:00 2026' }],
      source: 'cli-register'
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    // The fix: the handle is DECLARED, not dropped (the deadlock root).
    const record = getTerminalRecord(payload.terminal_id);
    expect(record?.handle).toBe('@fClaude');
    // And the witness table stays clean — an uncorroborated pane never binds.
    expect(getLiveBinding('@fClaude')).toBeNull();
  });

  it('still binds the witness when the pane IS corroborated (no regression)', async () => {
    setListPanePidsForTests(() => ({ status: 0, stdout: '%36 5555\n', stderr: '' }));
    const response = await callPost(JSON.stringify({
      name: 'fable-cowork4',
      handle: '@fClaudeTwo',
      pane: '%36',
      pids: [{ pid: 5555, pid_start: 'Wed Jun 11 01:00:00 2026' }],
      source: 'cli-register'
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(getTerminalRecord(payload.terminal_id)?.handle).toBe('@fClaudeTwo');
    expect(getLiveBinding('@fClaudeTwo')?.terminal_id).toBe(payload.terminal_id);
  });
});
