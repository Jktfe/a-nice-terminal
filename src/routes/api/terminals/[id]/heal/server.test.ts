/**
 * /api/terminals/[id]/heal endpoint tests (2026-05-16).
 *
 * Uses real terminal_records rows but mocks the underlying
 * `autoRegisterTerminalForSpawnedSession` so we don't have to invoke
 * tmux/ps in CI. The endpoint's contract is:
 *   - 404 if no terminal_records row
 *   - { healed: false } if record exists but tmux_target_pane unset
 *   - { healed: false } if tmux pane not found (helper returns null)
 *   - { healed: true, terminal } on success
 *   - 403 if Bearer rbt_*
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('$lib/server/terminalsStore', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/terminalsStore')>('$lib/server/terminalsStore');
  return {
    ...actual,
    // Mock to avoid invoking real tmux/ps in tests.
    autoRegisterTerminalForSpawnedSession: vi.fn(),
    getTerminalById: vi.fn()
  };
});

import { POST as healPost } from './+server';
import {
  autoRegisterTerminalForSpawnedSession,
  getTerminalById
} from '$lib/server/terminalsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(path: string, init: RequestInit | undefined, params: Record<string, string>): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method: 'POST', ...(init ?? {}) });
  return { request, params, url };
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

describe('/api/terminals/[id]/heal', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-heal-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    vi.mocked(autoRegisterTerminalForSpawnedSession).mockReset();
    vi.mocked(getTerminalById).mockReset();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
  });

  it('returns 404 when no terminal_records row exists', async () => {
    const response = await runHandler(
      healPost as unknown as AnyHandler,
      eventFor('/api/terminals/phantom/heal', undefined, { id: 'phantom' })
    );
    expect(response.status).toBe(404);
  });

  it('returns healed=false when the helper returns null (tmux pane gone)', async () => {
    // createTerminalRecord defaults tmux_target_pane to <sessionId>:0.0,
    // so we don't need to set it explicitly.
    createTerminalRecord({ sessionId: 't_dead_pane', name: 'dead', autoForwardRoomId: null });

    vi.mocked(autoRegisterTerminalForSpawnedSession).mockReturnValueOnce(null);

    const response = await runHandler(
      healPost as unknown as AnyHandler,
      eventFor('/api/terminals/t_dead_pane/heal', undefined, { id: 't_dead_pane' })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { healed: boolean; tmuxPane: string };
    expect(body.healed).toBe(false);
    expect(body.tmuxPane).toBe('t_dead_pane:0.0');
  });

  it('returns healed=true with the registered terminal on success', async () => {
    createTerminalRecord({
      sessionId: 't_live',
      name: 'live',
      autoForwardRoomId: null,
      agentKind: 'claude'
    });
    // tmux_target_pane defaults to 't_live:0.0' from createTerminalRecord.

    const fakeRow = {
      id: 't_live',
      pid: 9999,
      pid_start: 'Sat May 16 09:00:00 2026',
      name: 'auto:t_live',
      tmux_target_pane: 't_live:0.0',
      agent_kind: 'claude',
      pane_status: 'unknown' as const,
      pane_stale_since: null,
      source: 'spawn-auto',
      expires_at: 9999999,
      meta: '{}',
      created_at: 1,
      updated_at: 1
    };
    vi.mocked(autoRegisterTerminalForSpawnedSession).mockReturnValueOnce(fakeRow);
    vi.mocked(getTerminalById).mockReturnValueOnce(fakeRow);

    const response = await runHandler(
      healPost as unknown as AnyHandler,
      eventFor('/api/terminals/t_live/heal', undefined, { id: 't_live' })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { healed: boolean; terminal: { id: string; pid: number }; message: string };
    expect(body.healed).toBe(true);
    expect(body.terminal.id).toBe('t_live');
    expect(body.terminal.pid).toBe(9999);
    expect(body.message).toMatch(/Registered identity row for t_live \(pid=9999\)/);
    expect(vi.mocked(autoRegisterTerminalForSpawnedSession)).toHaveBeenCalledWith({
      sessionId: 't_live',
      tmuxTargetPane: 't_live:0.0',
      agentKind: 'claude'
    });
  });

  it('rejects Bearer rbt_* with 403', async () => {
    const response = await runHandler(
      healPost as unknown as AnyHandler,
      eventFor('/api/terminals/anything/heal', {
        headers: { authorization: 'Bearer rbt_remote' }
      }, { id: 'anything' })
    );
    expect(response.status).toBe(403);
  });
});
