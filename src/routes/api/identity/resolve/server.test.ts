import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createSession } from '$lib/server/antSessionStore';
import { addMember } from '$lib/server/membershipStore';
import { bootstrapV02Identity } from '$lib/server/v02RegisterBootstrap';
import * as v02Runtimes from '$lib/server/v02RuntimesStore';

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

  it('prefers durable room_membership session identity over legacy terminal membership', async () => {
    const terminal = upsertTerminal({ pid: 555, pid_start: 'pstart', name: 'resolve-durable' });
    const session = createSession({
      id: 'sess-durable-resolve',
      kind: 'local-cli',
      label: '@durable',
      terminalId: terminal.id
    });
    addMember('r-1', '@durable', session.id);

    const response = await callPost(JSON.stringify({
      pids: [{ pid: 555, pid_start: 'pstart' }],
      room_id: 'r-1',
      sessionId: session.id
    }));

    const payload = await response.json();
    expect(payload.handle).toBe('@durable');
    expect(payload.terminal_id).toBe(terminal.id);
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

  describe('v0.2 removal — resolve no longer consults sidecar runtime identity', () => {
    it('returns null v0.2 fields even when a live v0.2 runtime matches the chain', async () => {
      const isoNow = new Date().toISOString();
      const bootstrap = bootstrapV02Identity({
        name: 'v02-resolve',
        pid: 4242,
        pid_start: isoNow,
        legacy_terminal_id: 'legacy-resolve-1'
      });
      const response = await callPost(JSON.stringify({
        pids: [{ pid: 4242, pid_start: isoNow }]
      }));
      const payload = await response.json();
      expect(payload.terminal_id).toBeNull();
      expect(payload.v02_agent_id).toBeNull();
      expect(payload.v02_runtime_id).toBeNull();
      expect(v02Runtimes.getRuntimeById(bootstrap.runtime_id)?.status).toBe('live');
    });

    it('does not surface an ancestor v0.2 runtime when the resolved terminal is different', async () => {
      const leafStart = '2026-06-10T11:21:00.000Z';
      const parentStart = '2026-06-08T07:53:47.000Z';
      const leaf = upsertTerminal({ pid: 63707, pid_start: leafStart, name: 'antchatClaudeHomebrew' });
      const parent = upsertTerminal({ pid: 34491, pid_start: parentStart, name: 'minimax-codex' });
      bootstrapV02Identity({
        name: 'minimax-codex',
        pid: 34491,
        pid_start: parentStart,
        legacy_terminal_id: parent.id,
        handle: '@minimaxs-codex'
      });

      const response = await callPost(
        JSON.stringify({
          pids: [
            { pid: 63707, pid_start: leafStart },
            { pid: 34491, pid_start: parentStart }
          ]
        })
      );
      const payload = await response.json();
      expect(payload.terminal_id).toBe(leaf.id);
      expect(payload.name).toBe('antchatClaudeHomebrew');
      expect(payload.v02_agent_id).toBeNull();
      expect(payload.v02_runtime_id).toBeNull();
    });

    it('returns null v0.2 fields when only the legacy row exists (no v0.2 bootstrap ran)', async () => {
      upsertTerminal({ pid: 600, pid_start: 'pp', name: 'legacy-only' });
      const response = await callPost(JSON.stringify({
        pids: [{ pid: 600, pid_start: 'pp' }]
      }));
      const payload = await response.json();
      expect(payload.terminal_id).toBeTruthy();
      expect(payload.v02_agent_id).toBeNull();
      expect(payload.v02_runtime_id).toBeNull();
    });

    it('returns null v0.2 fields for reclaimed and live v0.2 runtimes alike', async () => {
      const isoNow = new Date().toISOString();
      const first = bootstrapV02Identity({
        name: 'shadow-test',
        pid: 7,
        pid_start: isoNow,
        legacy_terminal_id: 'legacy-shadow-A'
      });
      // Second register reclaims the first (different PID), but the OLD
      // pid+pid_start in v0.2 stays as a 'reclaimed' row in the audit
      // history. The structural fix: status='live' filter on
      // lookupRuntimeByPidChain MUST exclude reclaimed rows.
      const second = bootstrapV02Identity({
        name: 'shadow-test',
        pid: 8,
        pid_start: isoNow,
        legacy_terminal_id: 'legacy-shadow-B'
      });
      const response = await callPost(JSON.stringify({
        pids: [{ pid: 7, pid_start: isoNow }]
      }));
      const payload = await response.json();
      // pid=7 in v0.2 is 'reclaimed' — sidecar must return null.
      expect(payload.v02_runtime_id).toBeNull();
      const liveResponse = await callPost(JSON.stringify({
        pids: [{ pid: 8, pid_start: isoNow }]
      }));
      const livePayload = await liveResponse.json();
      expect(livePayload.v02_runtime_id).toBeNull();
      expect(livePayload.v02_agent_id).toBeNull();
      expect(v02Runtimes.getRuntimeById(first.runtime_id)?.status).toBe('reclaimed');
      expect(v02Runtimes.getRuntimeById(second.runtime_id)?.status).toBe('live');
    });

    it('ignores a v0.2-only runtime when the terminal lookup misses', async () => {
      const isoNow = new Date().toISOString();
      const bootstrap = bootstrapV02Identity({
        name: 'v02-only-resolve',
        pid: 11111,
        pid_start: isoNow,
        legacy_terminal_id: 'synthetic-not-in-legacy'
      });
      const response = await callPost(JSON.stringify({
        pids: [{ pid: 11111, pid_start: isoNow }]
      }));
      const payload = await response.json();
      expect(payload.terminal_id).toBeNull();
      expect(payload.v02_agent_id).toBeNull();
      expect(payload.v02_runtime_id).toBeNull();
      expect(v02Runtimes.getRuntimeById(bootstrap.runtime_id)?.status).toBe('live');
    });

    it('does not use v0.2 pid_start_iso normalisation as an identity fallback', async () => {
      const rawLstart = 'Tue May 13 00:00:00 2026';
      const bootstrap = bootstrapV02Identity({
        name: 'iso-roundtrip',
        pid: 222,
        pid_start: rawLstart,
        legacy_terminal_id: 'legacy-iso'
      });
      const response = await callPost(JSON.stringify({
        pids: [{ pid: 222, pid_start: rawLstart }]
      }));
      const payload = await response.json();
      expect(payload.v02_agent_id).toBeNull();
      expect(payload.v02_runtime_id).toBeNull();
      expect(v02Runtimes.getRuntimeById(bootstrap.runtime_id)).not.toBeNull();
    });
  });
});
