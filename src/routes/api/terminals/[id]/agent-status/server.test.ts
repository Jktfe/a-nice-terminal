// Route tests for /api/terminals/:id/agent-status (M3.4a-v2 T2 delta-1).
// Per contract Q4 + Q7: PUT body { status, nonce, evidence_json? },
// hook-nonce auth with PER-PUSH rotation, flat response shape with
// since_ms + evidence_json.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { installHookNonce } from '$lib/server/agentStatusHookAuth';
import { getAgentStatus } from '$lib/server/agentStatusStore';
import { GET, PUT } from './+server';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

function makeTerminal(name: string = 't1'): string {
  return upsertTerminal({ pid: 1234, pid_start: 'pst', name }).id;
}

function getReq(id: string): Parameters<typeof GET>[0] {
  return { params: { id } } as unknown as Parameters<typeof GET>[0];
}

function putReq(id: string, body: unknown): Parameters<typeof PUT>[0] {
  return {
    request: new Request(`http://x/api/terminals/${id}/agent-status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    params: { id }
  } as unknown as Parameters<typeof PUT>[0];
}

describe('GET /api/terminals/:id/agent-status (Q7 flat shape)', () => {
  it('200 returns flat row with terminal_id + agent_status + source + at_ms + since_ms', async () => {
    const tid = makeTerminal();
    const res = await GET(getReq(tid));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminal_id).toBe(tid);
    expect(body.agent_status).toBe('idle');
    expect(body.agent_status_source).toBe('default');
    expect(typeof body.agent_status_at_ms).toBe('number');
    expect(typeof body.since_ms).toBe('number');
    expect(body.since_ms).toBeGreaterThanOrEqual(0);
  });

  it('404 unknown terminal', async () => {
    await expect(GET(getReq('unknown-tid'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('PUT /api/terminals/:id/agent-status (Q4 hook-nonce + PER-PUSH rotation)', () => {
  it('200 verifies nonce + rotates + returns flat row + next_nonce', async () => {
    const tid = makeTerminal();
    const nonce = installHookNonce(tid)!;
    const res = await PUT(putReq(tid, { status: 'thinking', nonce, evidence_json: { tool: 'claude_code' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent_status).toBe('thinking');
    expect(body.agent_status_source).toBe('hook');
    expect(typeof body.next_nonce).toBe('string');
    expect(body.next_nonce.length).toBeGreaterThan(0);
    expect(body.next_nonce).not.toBe(nonce);
    expect(getAgentStatus(tid)?.agent_status).toBe('thinking');
  });

  it('401 nonce mismatch (wrong nonce presented)', async () => {
    const tid = makeTerminal();
    installHookNonce(tid);
    await expect(PUT(putReq(tid, { status: 'thinking', nonce: 'wrong-nonce-bytes' })))
      .rejects.toMatchObject({ status: 401 });
  });

  it('401 nonce missing from body', async () => {
    const tid = makeTerminal();
    await expect(PUT(putReq(tid, { status: 'thinking' }))).rejects.toMatchObject({ status: 401 });
  });

  it('401 reusing OLD nonce after rotation (per-push rotation invariant)', async () => {
    const tid = makeTerminal();
    const nonce1 = installHookNonce(tid)!;
    await PUT(putReq(tid, { status: 'thinking', nonce: nonce1 }));
    await expect(PUT(putReq(tid, { status: 'working', nonce: nonce1 })))
      .rejects.toMatchObject({ status: 401 });
  });

  it('next_nonce returned by previous PUT is accepted on next push', async () => {
    const tid = makeTerminal();
    const nonce1 = installHookNonce(tid)!;
    const res1 = await PUT(putReq(tid, { status: 'thinking', nonce: nonce1 }));
    const body1 = await res1.json();
    const nonce2 = body1.next_nonce as string;
    const res2 = await PUT(putReq(tid, { status: 'working', nonce: nonce2 }));
    expect(res2.status).toBe(200);
    expect(getAgentStatus(tid)?.agent_status).toBe('working');
  });

  it('400 bad status enum (rejects blocked/offline NOT in canonical 4)', async () => {
    const tid = makeTerminal();
    const nonce = installHookNonce(tid)!;
    await expect(PUT(putReq(tid, { status: 'blocked', nonce }))).rejects.toMatchObject({ status: 400 });
  });

  it('401 unknown terminal (verifyAndRotateHookNonce returns null)', async () => {
    await expect(PUT(putReq('unknown-tid', { status: 'idle', nonce: 'x' })))
      .rejects.toMatchObject({ status: 401 });
  });

  it('400 invalid JSON body', async () => {
    const tid = makeTerminal();
    const req = {
      request: new Request(`http://x/api/terminals/${tid}/agent-status`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not json'
      }),
      params: { id: tid }
    } as unknown as Parameters<typeof PUT>[0];
    await expect(PUT(req)).rejects.toMatchObject({ status: 400 });
  });

  it('PUT with evidence_json as a string is parsed and persisted', async () => {
    const tid = makeTerminal();
    const nonce = installHookNonce(tid)!;
    const evidenceStr = JSON.stringify({ k: 'v' });
    await PUT(putReq(tid, { status: 'thinking', nonce, evidence_json: evidenceStr }));
    const getRes = await GET(getReq(tid));
    const body = await getRes.json();
    expect(body.evidence_json).toBeTruthy();
  });
});
