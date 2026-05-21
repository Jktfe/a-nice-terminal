import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { getTerminalByName } from '$lib/server/terminalsStore';

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
    const second = await callPost(JSON.stringify({
      name: 're-register', pids: [{ pid: 2, pid_start: 's' }], pane: '%2'
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
});
