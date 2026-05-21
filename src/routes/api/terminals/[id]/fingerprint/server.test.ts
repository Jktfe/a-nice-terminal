// Route tests for /api/terminals/:id/fingerprint (M3.2a).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { upsertTerminal, getTerminalById, type TerminalRow } from '$lib/server/terminalsStore';
import { GET } from './+server';

const ADMIN_TOKEN = 'admin-fingerprint-tok';
const PREV = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});

function freshTerminal(name: string, agentKind: string | null = null): TerminalRow {
  const t = upsertTerminal({ pid: 1234, pid_start: 'lstart', name });
  if (agentKind !== null) {
    getIdentityDb().prepare(`UPDATE terminals SET agent_kind = ? WHERE id = ?`).run(agentKind, t.id);
  }
  return getTerminalById(t.id) as TerminalRow;
}

function req(id: string, query = '', auth?: string): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = `Bearer ${auth}`;
  return {
    request: new Request(`http://x/api/terminals/${id}/fingerprint${query}`, { headers }),
    params: { id }, url: new URL(`http://x/api/terminals/${id}/fingerprint${query}`)
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/terminals/:id/fingerprint (M3.2a)', () => {
  it('200 happy with name-source LOW detection (no auth needed when read-only)', async () => {
    const t = freshTerminal('claude-1');
    const res = await GET(req(t.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminal_id).toBe(t.id);
    expect(body.kind).toBe('claude_code');
    expect(body.confidence).toBe('low');
    expect(body.evidence.source).toBe('name');
  });

  it('JSON shape includes terminal_id + kind + driver + confidence + fallback + evidence', async () => {
    const t = freshTerminal('codex-2');
    const body = await (await GET(req(t.id))).json();
    expect(Object.keys(body).sort()).toEqual(
      ['confidence', 'driver', 'evidence', 'fallback', 'kind', 'terminal_id']);
  });

  it('404 unknown terminal', async () => {
    await expect(GET(req('does-not-exist'))).rejects.toMatchObject({ status: 404 });
  });

  it('writeBack=1 without admin-bearer → 401', async () => {
    const t = freshTerminal('cursor-3');
    await expect(GET(req(t.id, '?writeBack=1'))).rejects.toMatchObject({ status: 401 });
  });

  it('writeBack=1 + remote terminal still returns detection but does NOT mutate (Q2 lock)', async () => {
    const t = freshTerminal('claude-remote', 'remote');
    const res = await GET(req(t.id, '?writeBack=1', ADMIN_TOKEN));
    expect(res.status).toBe(200);
    const after = getTerminalById(t.id) as TerminalRow;
    expect(after.agent_kind).toBe('remote');
  });
});
