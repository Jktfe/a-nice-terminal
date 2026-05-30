import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
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
import {
  createTerminalRecord,
  getHandleAliases,
  getTerminalRecord
} from '$lib/server/terminalRecordsStore';

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
  it('Phase A2 (a): 409 when name is already live with a different PID', async () => {
    const first = await callPost(JSON.stringify({
      name: 'conflict-live', pids: [{ pid: 1111, pid_start: 's-orig' }]
    }));
    expect(first.status).toBe(201);
    const second = await callPost(JSON.stringify({
      name: 'conflict-live', pids: [{ pid: 2222, pid_start: 's-new' }]
    }));
    expect(second.status).toBe(409);
    const payload = await second.json().catch(() => ({}));
    const msg = String(payload?.message ?? '');
    expect(msg).toContain("Name 'conflict-live' is already live");
    expect(msg).toMatch(/Reclaim with --handle/);
    const stored = getTerminalByName('conflict-live');
    expect(stored?.pid).toBe(1111);
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
      name: 'recycle-name', pids: [{ pid: 6666, pid_start: 's-new' }]
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

    it('does NOT move memberships when old terminal heartbeat is fresh', async () => {
      // Stage: old terminal bound with heartbeat 30 seconds ago (alive).
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
      expect(response.status).toBe(201);
      // All 3 memberships UNTOUCHED — still bound to the old terminal.
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
});
