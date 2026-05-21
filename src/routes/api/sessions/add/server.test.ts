import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal, getTerminalByName } from '$lib/server/terminalsStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-route-sessions-add-'));
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
  const url = new URL('http://localhost/api/sessions/add');
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
