import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-route-resolve-'));
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
  const url = new URL('http://localhost/api/identity/resolve');
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

describe('POST /api/identity/resolve', () => {
  it('returns terminal info (no handle) when room_id is absent', async () => {
    upsertTerminal({ pid: 555, pid_start: 'pstart', name: 'resolve-target' });
    const response = await callPost(JSON.stringify({
      pids: [{ pid: 555, pid_start: 'pstart' }]
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.name).toBe('resolve-target');
    expect(payload.handle).toBeNull();
  });

  it('returns the room-scoped handle when room_id matches a membership', async () => {
    const t = upsertTerminal({ pid: 555, pid_start: 'pstart', name: 'resolve-with-handle' });
    addMembership({ room_id: 'r-1', handle: '@claude2', terminal_id: t.id });
    const response = await callPost(JSON.stringify({
      pids: [{ pid: 555, pid_start: 'pstart' }],
      room_id: 'r-1'
    }));
    const payload = await response.json();
    expect(payload.handle).toBe('@claude2');
    expect(payload.terminal_id).toBe(t.id);
  });

  it('returns null fields when no terminal matches the chain', async () => {
    const response = await callPost(JSON.stringify({
      pids: [{ pid: 9999, pid_start: 'never' }]
    }));
    const payload = await response.json();
    expect(payload.terminal_id).toBeNull();
    expect(payload.name).toBeNull();
  });

  it('rejects missing pids with 400', async () => {
    const response = await callPost(JSON.stringify({}));
    expect(response.status).toBe(400);
  });

  it('walks the chain — returns first ancestor match if leaf is unknown', async () => {
    upsertTerminal({ pid: 200, pid_start: 'a', name: 'ancestor-match' });
    const response = await callPost(JSON.stringify({
      pids: [
        { pid: 9999, pid_start: 'unknown' },
        { pid: 200,  pid_start: 'a' }
      ]
    }));
    const payload = await response.json();
    expect(payload.name).toBe('ancestor-match');
  });
});
