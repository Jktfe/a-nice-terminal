// Integration tests for the archived-name 409 + revive/fresh intent paths
// added in Task 4 (spec 2026-05-31).
//
// IMPORTANT: archived terminals are created via upsertTerminal() directly
// (not the register endpoint) so that NO v02_agents row exists for their
// derived handle. This keeps knownV02Agent = null for the archived name,
// allowing our new check to fire. Using the register endpoint to create
// the terminal would create a v02_agents row and the v0.2 reclaim path
// would take precedence, bypassing the archived-name 409 entirely.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  upsertTerminal,
  setTerminalStatus,
  getTerminalById,
  getLiveTerminalByName
} from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-route-revive-'));
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

describe('POST /api/identity/register — archived-name intent handling', () => {
  // Case 1: archived match exists + no intent flag → 409 with candidates list
  it('returns 409 archived_name_matches when an archived terminal owns the base name and no intent is given', async () => {
    // Create and archive a terminal directly (no endpoint → no v02_agents row
    // → knownV02Agent = null → our new check fires).
    const archived = upsertTerminal({ pid: 910001, pid_start: 'arc-a', name: 'revive-test' });
    setTerminalStatus(archived.id, 'archived');

    const response = await callPost(JSON.stringify({
      name: 'revive-test',
      pids: [{ pid: 910099, pid_start: 'new-fresh' }]
    }));

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe('archived_name_matches');
    expect(Array.isArray(payload.candidates)).toBe(true);
    expect(payload.candidates.map((c: { id: string }) => c.id)).toContain(archived.id);
  });

  // Case 2: fresh:true → 201; archived row stays tagged; new live terminal owns the base name
  it('proceeds with a NEW live terminal when fresh:true is provided', async () => {
    const archived = upsertTerminal({ pid: 920001, pid_start: 'arc-b', name: 'fresh-intent' });
    setTerminalStatus(archived.id, 'archived');

    const response = await callPost(JSON.stringify({
      name: 'fresh-intent',
      pids: [{ pid: 920099, pid_start: 'new-fresh' }],
      fresh: true
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.terminal_id).toBeTruthy();

    // The archived terminal's name must still carry the [A] tag
    const archivedRow = getTerminalById(archived.id);
    expect(archivedRow?.name).toMatch(/^\[A/);

    // A different live terminal now owns the base name
    const live = getLiveTerminalByName('fresh-intent');
    expect(live).not.toBeNull();
    expect(live?.id).not.toBe(archived.id);
  });

  // Case 3: revive:<id> → 201; archived terminal restored to base name + live
  it('un-archives the target terminal when revive:<id> is provided', async () => {
    const archived = upsertTerminal({ pid: 930001, pid_start: 'arc-c', name: 'revive-direct' });
    setTerminalStatus(archived.id, 'archived');

    // Confirm it is tagged before the revive
    expect(getTerminalById(archived.id)?.name).toMatch(/^\[A/);

    const response = await callPost(JSON.stringify({
      name: 'revive-direct',
      pids: [{ pid: 930099, pid_start: 'new-fresh' }],
      revive: archived.id
    }));

    expect(response.status).toBe(201);

    // The revived terminal must have the base name restored and status live
    const revived = getTerminalById(archived.id);
    expect(revived?.name).toBe('revive-direct');
    expect(revived?.status).toBe('live');
  });
});
