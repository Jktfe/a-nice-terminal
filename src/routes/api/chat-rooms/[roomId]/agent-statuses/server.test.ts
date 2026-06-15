import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { setAgentStatus } from '$lib/server/agentStatusStore';
import {
  registerCliAgentForTests,
  resetCliAgentRegistryForTests,
  type CliAgentHandle
} from '$lib/server/cliAgentRegistry';
import { _clearStateReaderCache } from '$lib/server/agentStateReader';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { setTerminalStatus, upsertTerminal } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousHomeValue = process.env.HOME;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-agent-statuses-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.HOME = tmpDir;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetCliAgentRegistryForTests();
  _clearStateReaderCache();
});

afterEach(() => {
  resetCliAgentRegistryForTests();
  _clearStateReaderCache();
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousHomeValue === undefined) delete process.env.HOME;
  else process.env.HOME = previousHomeValue;
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

function fakeCliAgent(input: {
  cli: 'codex' | 'pi';
  handleId: string;
  roomId: string;
  sessionId: string | null;
  cwd?: string | null;
}): CliAgentHandle {
  return {
    handleId: input.handleId,
    cli: input.cli,
    cwd: input.cwd ?? null,
    roomId: input.roomId,
    spawnedAtMs: Date.now() - 10_000,
    getSessionId: () => input.sessionId,
    async sendCommand<TResult = unknown>(): Promise<TResult> {
      return {} as TResult;
    },
    async sendPrompt() {
      return { threadId: input.sessionId };
    },
    async stop() {}
  };
}

function writeAgentState(cli: 'codex-cli' | 'pi', sessionId: string, state: string): void {
  const dir = join(tmpDir, '.ant', 'state', cli);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.json`),
    JSON.stringify({
      state,
      session_start: '2026-06-08T12:00:00Z',
      cwd: '/repo/test'
    })
  );
  _clearStateReaderCache();
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
      nowMs: Date.now() - 302_000
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
    expect(row.statusSource).toBe('default');
    expect(typeof row.uptimeMs === 'number' || row.uptimeMs === null).toBe(true);
    if (typeof row.uptimeMs === 'number') {
      expect(row.uptimeMs).toBeGreaterThanOrEqual(0);
    }
    expect(row.contextFill).toBeNull();
    // Phase C2 (0.1.13): lifecycle status surfaces on the projection. A
    // fresh terminal defaults to 'live' (db.ts NOT NULL DEFAULT).
    expect(row.lifecycleStatus).toBe('live');
  });

  it('surfaces lifecycleStatus="archived" for archived bound terminals', async () => {
    const room = createChatRoom({ name: 'lifecycle-archived', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const terminal = upsertTerminal({ pid: 1002, pid_start: 'p2', name: 'agent-term-2' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    setTerminalStatus(terminal.id, 'archived');

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.statuses).toHaveLength(1);
    expect(payload.statuses[0].lifecycleStatus).toBe('archived');
  });

  it('surfaces lifecycleStatus=null when no terminal is bound', async () => {
    // Membership-less agent: no addMembership() call. The LEFT JOIN
    // returns no terminal row, so the projection should hold lifecycle
    // status as null rather than dropping the entry.
    const room = createChatRoom({ name: 'lifecycle-unbound', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.statuses).toHaveLength(1);
    expect(payload.statuses[0].lifecycleStatus).toBeNull();
  });

  it('surfaces openAsk=true when the CLI reports response-required (separate axis)', async () => {
    const room = createChatRoom({ name: 'openask-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const terminal = upsertTerminal({ pid: 2002, pid_start: 'p2', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'response-required', source: 'hook' });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(payload.statuses[0].openAsk).toBe(true);
  });

  it('openAsk=false for a plain working agent with no open ask', async () => {
    const room = createChatRoom({ name: 'noask-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const terminal = upsertTerminal({ pid: 3003, pid_start: 'p3', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'working', source: 'hook' });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(payload.statuses[0].openAsk).toBe(false);
  });

  it('promotes a quiet stored status when fresh PTY output exists', async () => {
    const room = createChatRoom({ name: 'pty-active-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const terminal = upsertTerminal({ pid: 3503, pid_start: 'p3b', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'idle', source: 'default', nowMs: 0 });
    getIdentityDb()
      .prepare(`UPDATE terminals SET last_pty_byte_at_ms = ? WHERE id = ?`)
      .run(Date.now(), terminal.id);

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(payload.statuses[0]).toMatchObject({
      handle: '@agent',
      status: 'working',
      statusSource: 'ant-activity',
      crawlerMotion: 'resting'
    });
  });

  it('surfaces the effective status source so UI pills can explain context', async () => {
    const room = createChatRoom({ name: 'source-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const terminal = upsertTerminal({ pid: 4004, pid_start: 'p4', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'thinking', source: 'hook' });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(payload.statuses[0]).toMatchObject({
      handle: '@agent',
      status: 'thinking',
      statusSource: 'hook',
      crawlerMotion: 'moving'
    });
  });

  it('includes room-scoped pi CLI agents using the canonical state-file reader', async () => {
    const room = createChatRoom({ name: 'pi-footer-room', whoCreatedIt: '@you' });
    writeAgentState('pi', 'pi-sess-1', 'Working');
    registerCliAgentForTests(fakeCliAgent({
      cli: 'pi',
      handleId: 'agent_pi_abc',
      roomId: room.id,
      sessionId: 'pi-sess-1'
    }));

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.statuses).toContainEqual(expect.objectContaining({
      handle: '@pi',
      status: 'working',
      statusSource: 'hook',
      lifecycleStatus: null
    }));
  });

  it('suffixes a spawned pi footer handle when @pi is already a room member', async () => {
    const room = createChatRoom({ name: 'pi-collision-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@pi' });
    writeAgentState('pi', 'pi-sess-2', 'Working');
    registerCliAgentForTests(fakeCliAgent({
      cli: 'pi',
      handleId: 'agent_pi_def',
      roomId: room.id,
      sessionId: 'pi-sess-2'
    }));

    const response = await callGet(room.id);
    const payload = await response.json();
    const handles = payload.statuses.map((row: { handle: string }) => row.handle);
    expect(handles).toContain('@pi');
    expect(handles).toContain('@pi-2');
    expect(new Set(handles).size).toBe(handles.length);
  });
});
