import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { bootstrapV02Identity } from '$lib/server/v02RegisterBootstrap';
import { createSession } from '$lib/server/antSessionStore';
import { addMember, isMember } from '$lib/server/membershipStore';

let tmpDir: string;
const previousEnv = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-whoami-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnv;
});

function eventForPost(body?: string) {
  const url = new URL('http://localhost/api/identity/whoami');
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
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('POST /api/identity/whoami', () => {
  it('returns 200 bound + handle when terminal + record exist', async () => {
    const terminal = upsertTerminal({ pid: 555, pid_start: 'pstart', name: 't-bound' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-bound', handle: '@alice' });
    const response = await callPost(JSON.stringify({ pids: [{ pid: 555, pid_start: 'pstart' }] }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('bound');
    expect(payload.handle).toBe('@alice');
    expect(payload.terminalId).toBe(terminal.id);
    expect(payload.terminalName).toBe('t-bound');
  });

  it('returns 422 registered-no-handle when terminal exists but record has null handle', async () => {
    const terminal = upsertTerminal({ pid: 600, pid_start: 'pstart', name: 't-no-handle' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-no-handle', handle: null });
    const response = await callPost(JSON.stringify({ pids: [{ pid: 600, pid_start: 'pstart' }] }));
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.status).toBe('registered-no-handle');
    expect(payload.terminalId).toBe(terminal.id);
  });

  it('returns 404 no-terminal when chain matches nothing', async () => {
    const response = await callPost(JSON.stringify({ pids: [{ pid: 9999, pid_start: 'never' }] }));
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.status).toBe('no-terminal');
  });

  it('returns 409 stale-rebind when PID matches but pid_start disagrees', async () => {
    const terminal = upsertTerminal({ pid: 700, pid_start: '2026-05-30T10:00:00.000Z', name: 't-stale' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-stale', handle: '@old-occupant' });
    const response = await callPost(
      JSON.stringify({ pids: [{ pid: 700, pid_start: '2026-05-30T20:00:00.000Z' }] })
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.status).toBe('stale-rebind');
    expect(payload.terminalId).toBe(terminal.id);
    expect(payload.recordedPidStart).toBe('2026-05-30T10:00:00.000Z');
    expect(payload.actualPidStart).toBe('2026-05-30T20:00:00.000Z');
  });

  it('walks the chain — returns first ancestor match if leaf is unknown', async () => {
    const terminal = upsertTerminal({ pid: 200, pid_start: 'a', name: 't-ancestor' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-ancestor', handle: '@ancestor' });
    const response = await callPost(JSON.stringify({
      pids: [
        { pid: 9999, pid_start: 'unknown' },
        { pid: 200, pid_start: 'a' }
      ]
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.handle).toBe('@ancestor');
  });

  it('falls back to v0.2 agents.primary_handle when terminal_records.handle is empty (post-cut-over reality)', async () => {
    const isoNow = new Date().toISOString();
    // Legacy half — terminals row + terminal_records row with EMPTY handle
    // (the exact state discovered in fresh-ant.db live smoke after PR #124).
    const terminal = upsertTerminal({ pid: 800, pid_start: isoNow, name: 't-v02-bound' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-v02-bound', handle: '' });
    // v0.2 half — agent + runtime linked to that legacy terminal_id.
    const bootstrap = bootstrapV02Identity({
      name: 't-v02-bound',
      pid: 800,
      pid_start: isoNow,
      legacy_terminal_id: terminal.id,
      handle: '@v02-resolved'
    });
    const response = await callPost(JSON.stringify({ pids: [{ pid: 800, pid_start: isoNow }] }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.handle).toBe('@v02-resolved');
    expect(payload.v02AgentId).toBe(bootstrap.agent_id);
  });

  it('resolves handle from clean room_membership when terminal_records.handle is empty (the "in-room but registered-no-handle" bug)', async () => {
    // Reproduces JWPK's Oldboys msg_3iqrmww20n: an agent is a live room member
    // (receives + posts via the session/lease path) yet whoami reported
    // "registered-no-handle" because the handle lives in room_membership keyed
    // by the durable session, not in terminal_records.handle / agents.primary_handle.
    const terminal = upsertTerminal({ pid: 4242, pid_start: 'pstart', name: 't-live-member' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-live-member', handle: '' });
    const session = createSession({ kind: 'local-cli', terminalId: terminal.id });
    addMember('room-live', '@member', session.id);

    const response = await callPost(JSON.stringify({ pids: [{ pid: 4242, pid_start: 'pstart' }] }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('bound');
    expect(payload.handle).toBe('@member');
    expect(payload.terminalId).toBe(terminal.id);
  });

  it('does NOT resolve a synthetic @browser-bs_ membership as a handle', async () => {
    // The clean roster excludes browser-session handles; whoami must too, so a
    // terminal that only carries a browser-session membership stays no-handle.
    const terminal = upsertTerminal({ pid: 4343, pid_start: 'pstart', name: 't-browser-only' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-browser-only', handle: '' });
    const session = createSession({ kind: 'local-cli', terminalId: terminal.id });
    // addMember refuses synthetic handles, so insert one directly to prove the
    // whoami query's own browser-bs exclusion holds (defence in depth).
    // isMember() ensures the room_membership table exists before the raw insert.
    isMember('room-bs', '@noop');
    const { getIdentityDb } = await import('$lib/server/db');
    getIdentityDb()
      .prepare(
        `INSERT INTO room_membership (room_id, handle, session_id, created_at_ms) VALUES (?, ?, ?, ?)`
      )
      .run('room-bs', '@browser-bs_deadbeef', session.id, Date.now());

    const response = await callPost(JSON.stringify({ pids: [{ pid: 4343, pid_start: 'pstart' }] }));
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.status).toBe('registered-no-handle');
  });

  it('treats empty-string terminal_records.handle as missing (not bound)', async () => {
    const terminal = upsertTerminal({ pid: 900, pid_start: 'pstart', name: 't-empty-handle' });
    createTerminalRecord({ sessionId: terminal.id, name: 't-empty-handle', handle: '' });
    const response = await callPost(JSON.stringify({ pids: [{ pid: 900, pid_start: 'pstart' }] }));
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.status).toBe('registered-no-handle');
  });

  it('rejects empty body with 400', async () => {
    const response = await callPost(JSON.stringify({}));
    expect(response.status).toBe(400);
  });

  it('rejects missing pids with 400', async () => {
    const response = await callPost('not-json');
    expect(response.status).toBe(400);
  });
});
