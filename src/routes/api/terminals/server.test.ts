/**
 * /api/terminals POST — SPAWN-LOCALITY-GATE (2026-05-15, JWPK Slice B item 1).
 *
 * The gate blocks remote-bridge bearer tokens (Bearer rbt_*) from reaching
 * the raw-PTY spawn path. This file covers ONLY the gate behaviour — the
 * positive spawn path is exercised end-to-end by the live service.
 *
 * IMPORTANT: ptyClient.spawnTerminal is MOCKED below. Without the mock,
 * the "non-rbt passes the gate" tests proceed all the way through the
 * handler and have the real pty-daemon spawn live tmux sessions
 * (observed 2026-05-15 after first ship — zombie tmux sessions
 * t_71onoybz2h / t_ypxpoalblk surfaced unattended in JWPK's terminal).
 * The mock returns { alive: false } so the handler throws a 500 right
 * after the gate; tests then assert `status !== 403` to prove the gate
 * let the request through without actually spawning anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('$lib/server/ptyClient', () => ({
  spawnTerminal: vi.fn(async () => ({ alive: false })),
  listTerminals: vi.fn(async () => [])
}));

import { POST as terminalsPost } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(method: 'POST', path: string, init: RequestInit): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...init });
  return { request, params: {}, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('/api/terminals POST SPAWN-LOCALITY-GATE', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-terminals-spawn-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  it('rejects Bearer rbt_* (remote-bridge token) with 403', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer rbt_synthetic_remote_token_for_test'
        },
        body: JSON.stringify({ name: 'should-not-spawn' })
      })
    );
    expect(response.status).toBe(403);
  });

  it('rejects rbt_* irrespective of token suffix shape', async () => {
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer rbt_'
        },
        body: JSON.stringify({})
      })
    );
    expect(response.status).toBe(403);
  });

  it('does NOT reject a non-rbt Bearer header at the spawn-locality gate', async () => {
    // A request with a different Bearer prefix (e.g. chair-handoff / chat-invite)
    // must NOT be rejected at this gate — the gate is rbt_-specific by design.
    // The request will then proceed and likely fail downstream because there's
    // no live pty-daemon in the test env; we only assert that the failure is
    // NOT the 403 produced by this gate.
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer admin_some_other_token'
        },
        body: JSON.stringify({ name: 'should-pass-gate' })
      })
    );
    // Anything that's NOT the 403 gate-rejection means the gate let it through.
    // 500 (pty-daemon not running) or 201 (if it somehow spawns) both pass.
    expect(response.status).not.toBe(403);
  });

  it('does NOT reject requests with no Authorization header', async () => {
    // The user's browser path sends no Authorization header. This must pass
    // the gate so the existing UX is not broken by the JWPK-pragmatic shape.
    const response = await runHandler(
      terminalsPost as unknown as AnyHandler,
      eventFor('POST', '/api/terminals', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'browser-flow' })
      })
    );
    expect(response.status).not.toBe(403);
  });
});
