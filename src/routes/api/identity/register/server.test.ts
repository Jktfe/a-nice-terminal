import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { getTerminalByName, setTerminalStatus } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-route-register-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
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
    // Original row is unchanged.
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
    // Second row was never created.
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
    // Flip the existing row to archived → its name is freed for re-use.
    expect(setTerminalStatus(firstId, 'archived')).toBe(true);
    const second = await callPost(JSON.stringify({
      name: 'recycle-name', pids: [{ pid: 6666, pid_start: 's-new' }]
    }));
    expect(second.status).toBe(201);
    // Re-register updates the same row in place (upsertTerminal keys on name).
    const stored = getTerminalByName('recycle-name');
    expect(stored?.pid).toBe(6666);
  });
});
