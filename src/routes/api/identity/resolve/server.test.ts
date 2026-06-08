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
import {
  bootstrapV02Identity,
  pidStartToIso
} from '$lib/server/v02RegisterBootstrap';
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

  // -- M9b cut-over phase 1: surface v0.2 identity fields ---------------
  describe('M9b v0.2 sidecar', () => {
    it('returns v02_agent_id + v02_runtime_id when a live v0.2 runtime matches the chain', async () => {
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
      expect(payload.v02_agent_id).toBe(bootstrap.agent_id);
      expect(payload.v02_runtime_id).toBe(bootstrap.runtime_id);
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

    it('regression case #2: shadow runtimes (status=reclaimed) do NOT resolve via the v0.2 sidecar', async () => {
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
      // Sanity: live one still resolves.
      const liveResponse = await callPost(JSON.stringify({
        pids: [{ pid: 8, pid_start: isoNow }]
      }));
      const livePayload = await liveResponse.json();
      expect(livePayload.v02_runtime_id).toBe(second.runtime_id);
      // Confirm the reclaimed row is in fact reclaimed (sanity).
      expect(v02Runtimes.getRuntimeById(first.runtime_id)?.status).toBe('reclaimed');
    });

    it('returns v0.2 fields even when the legacy lookup misses (terminal_id is null but v02 hit)', async () => {
      // This case arises when the v0.2 cut-over has begun on a clean DB:
      // legacy terminals row was never created (because the new flow
      // skips it once M9d ships), but v02_runtimes was. M9b's dual-write
      // means in practice both land together, but we still want the
      // resolve endpoint to surface a v0.2 hit even when the legacy lookup
      // misses, so post-M9d callers don't need to wait for M9d for their
      // resolve to start working.
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
      expect(payload.v02_agent_id).toBe(bootstrap.agent_id);
      expect(payload.v02_runtime_id).toBe(bootstrap.runtime_id);
    });

    it('pid_start_iso ISO normalisation lets a raw lstart string resolve a v0.2 runtime registered with the same lstart string', async () => {
      // The bootstrap normalises whatever pid_start it receives into
      // pid_start_iso. resolve() applies the same normalisation, so the
      // same raw lstart string in the resolve body should produce a hit.
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
      expect(payload.v02_runtime_id).toBe(bootstrap.runtime_id);
      // Sanity: the stored row holds the ISO form.
      const runtime = v02Runtimes.getRuntimeById(bootstrap.runtime_id);
      expect(runtime?.pid_start_iso).toBe(pidStartToIso(rawLstart));
    });
  });
});
