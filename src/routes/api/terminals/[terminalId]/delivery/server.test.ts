import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  upsertTerminal,
  markPaneVerified,
  markPaneStale
} from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-delivery-test-token';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-delivery-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
});

async function callGet(terminalId: string, withAuth = true): Promise<Response> {
  const url = new URL(`http://localhost/api/terminals/${terminalId}/delivery`);
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  const event = { request: new Request(url, { headers }), params: { terminalId }, url } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

describe('GET /api/terminals/:terminalId/delivery', () => {
  it('rejects anonymous reads before exposing delivery state', async () => {
    const terminal = upsertTerminal({ pid: 3000, pid_start: 'p0', name: 'term-private' });
    markPaneVerified(terminal.id);

    const response = await callGet(terminal.id, false);
    expect(response.status).toBe(401);
  });

  it('returns 404 when the terminal is not registered', async () => {
    const response = await callGet('does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns verified delivery_state with ready-prompt reason for a verified pane', async () => {
    const terminal = upsertTerminal({ pid: 3001, pid_start: 'p1', name: 'term-verified' });
    markPaneVerified(terminal.id);

    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.terminal_id).toBe(terminal.id);
    expect(payload.delivery_state).toBe('verified');
    expect(payload.pane_status).toBe('verified');
    expect(payload.pane_stale_since).toBeNull();
    expect(payload.reason).toContain('ready prompt');
  });

  it('returns stale delivery_state with stopped-responding reason and timestamp for a stale pane', async () => {
    const terminal = upsertTerminal({ pid: 3002, pid_start: 'p2', name: 'term-stale' });
    markPaneStale(terminal.id);

    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.delivery_state).toBe('stale');
    expect(payload.pane_status).toBe('stale');
    expect(typeof payload.pane_stale_since).toBe('number');
    expect(payload.reason).toContain('Stopped responding');
    expect(payload.reason).toContain(String(payload.pane_stale_since));
  });

  it('returns unknown delivery_state with not-yet-observed reason for a freshly-registered terminal', async () => {
    const terminal = upsertTerminal({ pid: 3003, pid_start: 'p3', name: 'term-unknown' });

    const response = await callGet(terminal.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.delivery_state).toBe('unknown');
    expect(payload.pane_status).toBe('unknown');
    expect(payload.pane_stale_since).toBeNull();
    expect(payload.reason).toContain('not yet observed');
  });

  it('preserves name and agent_kind from the terminals row in the response', async () => {
    const terminal = upsertTerminal({ pid: 3004, pid_start: 'p4', name: 'term-meta-check' });
    markPaneVerified(terminal.id);

    const response = await callGet(terminal.id);
    const payload = await response.json();
    expect(payload.name).toBe('term-meta-check');
    expect(payload.agent_kind).toBeNull();
    expect(typeof payload.updated_at).toBe('number');
  });

  it('exposes BOTH delivery_state and raw pane_status so callers can see the underlying field', async () => {
    const terminal = upsertTerminal({ pid: 3005, pid_start: 'p5', name: 'term-both' });
    markPaneStale(terminal.id);

    const response = await callGet(terminal.id);
    const payload = await response.json();
    expect(payload.delivery_state).toBe('stale');
    expect(payload.pane_status).toBe('stale');
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(['delivery_state', 'pane_status', 'pane_stale_since', 'reason'])
    );
  });
});
