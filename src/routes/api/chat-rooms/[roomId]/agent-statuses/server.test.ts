import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { setAgentStatus } from '$lib/server/agentStatusStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-agent-statuses-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callGet(roomId: string): Promise<Response> {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/agent-statuses`);
  const event = { request: new Request(url), params: { roomId }, url } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

describe('GET /api/chat-rooms/:roomId/agent-statuses', () => {
  it('expires stale ant-activity working statuses before returning the room feed', async () => {
    const room = createChatRoom({ name: 'status-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const terminal = upsertTerminal({ pid: 1001, pid_start: 'p1', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    setAgentStatus({
      terminalId: terminal.id,
      newStatus: 'working',
      source: 'ant-activity',
      nowMs: Date.now() - 120_000
    });

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    // uptimeMs is non-deterministic (depends on terminal created_at clock
    // skew vs Date.now()); assert it's a non-negative number rather than
    // an exact value. The other fields stay exact.
    expect(payload.statuses).toHaveLength(1);
    const row = payload.statuses[0];
    expect(row.handle).toBe('@agent');
    expect(row.status).toBe('idle');
    expect(row.statusAtMs).toBe(0);
    expect(typeof row.uptimeMs === 'number' || row.uptimeMs === null).toBe(true);
    if (typeof row.uptimeMs === 'number') {
      expect(row.uptimeMs).toBeGreaterThanOrEqual(0);
    }
    expect(row.contextFill).toBeNull();
  });
});
