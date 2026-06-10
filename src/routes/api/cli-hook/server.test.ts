/**
 * /api/cli-hook endpoint tests — CLI-HOOK-BRIDGE Phase 1A
 * (2026-05-15, JWPK Slice B follow-up).
 *
 * Endpoint contract checks: POST validation, promoted-column extraction,
 * spawn-locality-style rbt_ rejection, GET query shapes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as cliHookPost, GET as cliHookGet } from './+server';
import {
  resetCliHookEventsStoreForTests,
  listCliHookEventsForSession
} from '$lib/server/cliHookEventsStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { getAgentStatus } from '$lib/server/agentStatusStore';
import { getTerminalById, upsertTerminal } from '$lib/server/terminalsStore';
import { createTerminalRecord, getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { appendTerminalRunEvent } from '$lib/server/terminalRunEventsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'POST' | 'GET',
  path: string,
  init?: RequestInit
): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method, ...(init ?? {}) });
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

function postBody(path: string, body: unknown, extraHeaders?: Record<string, string>): unknown {
  return eventFor('POST', path, {
    headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
    body: JSON.stringify(body)
  });
}

describe('/api/cli-hook POST', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-hook-route-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  it('accepts a minimal Claude SessionStart payload', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'sess-1',
        hook_event_name: 'SessionStart',
        source: 'startup'
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: number; source_cli: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.source_cli).toBe('claude-code');
    const rows = listCliHookEventsForSession('sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].hook_event_name).toBe('SessionStart');
  });

  it('extracts promoted columns from a PreToolUse payload', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'sess-2',
        hook_event_name: 'PreToolUse',
        transcript_path: '/tmp/t.jsonl',
        cwd: '/Users/x/proj',
        permission_mode: 'default',
        effort: { level: 'high' },
        tool_name: 'Bash',
        tool_use_id: 'tu_abc',
        tool_input: { command: 'echo hi' }
      })
    );
    expect(response.status).toBe(201);
    const [row] = listCliHookEventsForSession('sess-2');
    expect(row.transcript_path).toBe('/tmp/t.jsonl');
    expect(row.cwd).toBe('/Users/x/proj');
    expect(row.permission_mode).toBe('default');
    expect(row.effort_level).toBe('high');
    expect(row.tool_name).toBe('Bash');
    expect(row.tool_use_id).toBe('tu_abc');
    // Full payload survives in the JSON blob:
    const payload = JSON.parse(row.payload);
    expect(payload.tool_input.command).toBe('echo hi');
  });

  it('honours ?source=<cli> for partitioning', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=codex', {
        session_id: 'sess-codex',
        hook_event_name: 'PreToolUse'
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { source_cli: string };
    expect(body.source_cli).toBe('codex');
  });

  it('rejects missing session_id with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { hook_event_name: 'SessionStart' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects missing hook_event_name with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: 'sess' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects blank session_id with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: '   ', hook_event_name: 'SessionStart' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects a non-object body with 400', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      eventFor('POST', '/api/cli-hook', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(['not', 'an', 'object'])
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects Authorization: Bearer rbt_* with 403 (spawn-locality parity)', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody(
        '/api/cli-hook',
        { session_id: 'sess', hook_event_name: 'SessionStart' },
        { authorization: 'Bearer rbt_remote_token' }
      )
    );
    expect(response.status).toBe(403);
  });

  it('does NOT reject a non-rbt Bearer header', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody(
        '/api/cli-hook',
        { session_id: 'sess', hook_event_name: 'SessionStart' },
        { authorization: 'Bearer admin_other_token' }
      )
    );
    expect(response.status).toBe(201);
  });

  it('uses ant_session_id to update the ANT terminal pill while preserving the CLI hook session timeline', async () => {
    const terminal = upsertTerminal({
      pid: 1234,
      pid_start: 'Mon May 25 10:00:00 2026',
      name: 'status-target',
      source: 'test',
      ttlSeconds: 3600
    });

    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=claude-code', {
        session_id: 'claude-own-session-uuid',
        ant_session_id: terminal.id,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash'
      })
    );

    expect(response.status).toBe(201);
    expect(listCliHookEventsForSession('claude-own-session-uuid')).toHaveLength(1);
    expect(getAgentStatus(terminal.id)).toMatchObject({
      terminal_id: terminal.id,
      agent_status: 'working',
      agent_status_source: 'hook'
    });
  });

  // feat/status-cascade 2026-06-10 — dialect normalisation through the
  // endpoint: Copilot camelCase and Gemini Before*/After* names previously
  // persisted raw but projected NO status (mapper returned null).
  it('gemini BeforeTool drives the pill to working', async () => {
    const terminal = upsertTerminal({
      pid: 555, pid_start: 'Mon May 25 10:00:00 2026', name: 'gemini-pill', source: 'test', ttlSeconds: 3600
    });
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=gemini', {
        session_id: 'gem-1',
        ant_session_id: terminal.id,
        hook_event_name: 'BeforeTool'
      })
    );
    expect(response.status).toBe(201);
    expect(getAgentStatus(terminal.id)).toMatchObject({
      agent_status: 'working',
      agent_status_source: 'hook'
    });
  });

  it('copilot camelCase agentStop flips a working pill back to idle', async () => {
    const terminal = upsertTerminal({
      pid: 556, pid_start: 'Mon May 25 10:00:00 2026', name: 'copilot-pill', source: 'test', ttlSeconds: 3600
    });
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=copilot', {
        session_id: 'cop-1', ant_session_id: terminal.id, hook_event_name: 'preToolUse'
      })
    );
    expect(getAgentStatus(terminal.id)?.agent_status).toBe('working');
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=copilot', {
        session_id: 'cop-1', ant_session_id: terminal.id, hook_event_name: 'agentStop'
      })
    );
    expect(getAgentStatus(terminal.id)?.agent_status).toBe('idle');
  });

  it('unmapped failure-dialect events persist as evidence but write NO status', async () => {
    // postToolUseFailure's spec target is 'blocked' — a state the 4-state
    // enum does not have. It must not be approximated: event persists, pill
    // untouched.
    const terminal = upsertTerminal({
      pid: 557, pid_start: 'Mon May 25 10:00:00 2026', name: 'failure-pill', source: 'test', ttlSeconds: 3600
    });
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=copilot', {
        session_id: 'cop-2', ant_session_id: terminal.id, hook_event_name: 'preToolUse'
      })
    );
    expect(getAgentStatus(terminal.id)?.agent_status).toBe('working');
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=copilot', {
        session_id: 'cop-2', ant_session_id: terminal.id, hook_event_name: 'postToolUseFailure'
      })
    );
    expect(response.status).toBe(201);
    expect(listCliHookEventsForSession('cop-2')).toHaveLength(2); // persisted
    expect(getAgentStatus(terminal.id)?.agent_status).toBe('working'); // untouched
  });
});

describe('/api/cli-hook GET', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-hook-get-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  async function seed(): Promise<void> {
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: 's1', hook_event_name: 'A' })
    );
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', { session_id: 's1', hook_event_name: 'B' })
    );
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook?source=codex', { session_id: 's2', hook_event_name: 'cx' })
    );
  }

  it('returns events for a specific session newest-first', async () => {
    await seed();
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?session=s1')
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: { hook_event_name: string }[] };
    expect(body.events.map((e) => e.hook_event_name)).toEqual(['B', 'A']);
  });

  it('returns all recent events across sessions when no filter is set', async () => {
    await seed();
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook')
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: { hook_event_name: string }[] };
    expect(body.events).toHaveLength(3);
  });

  it('filters by source when source param is supplied', async () => {
    await seed();
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?source=codex')
    );
    const body = (await response.json()) as { events: { source_cli: string }[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].source_cli).toBe('codex');
  });

  it('rejects a non-integer limit with 400', async () => {
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?limit=abc')
    );
    expect(response.status).toBe(400);
  });

  it('rejects an out-of-range limit with 400', async () => {
    const response = await runHandler(
      cliHookGet as unknown as AnyHandler,
      eventFor('GET', '/api/cli-hook?limit=99999')
    );
    expect(response.status).toBe(400);
  });
});

/**
 * Session capture (JWPK reboot-survival, 2026-06-10): hook events durably
 * capture last cwd (terminals.last_path), the CLI's real session UUID
 * (terminal_records.cli_session_id — the durable --resume target), and an
 * auto-mined boot_command — never clobbering operator-set values.
 */
describe('/api/cli-hook POST — session capture', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-hook-capture-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  function seedTerminal(name: string): string {
    const terminal = upsertTerminal({
      pid: 4321,
      pid_start: 'Mon May 25 10:00:00 2026',
      name,
      source: 'test',
      ttlSeconds: 3600
    });
    return terminal.id;
  }

  it('captures cwd into terminals.last_path on every event and live-updates it', async () => {
    const terminalId = seedTerminal('capture-cwd');

    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-cwd',
        ant_session_id: terminalId,
        hook_event_name: 'PreToolUse',
        cwd: '/Users/you/projA'
      })
    );
    expect(getTerminalById(terminalId)?.last_path).toBe('/Users/you/projA');

    // The agent cd's; a later event carries the new cwd and last_path follows.
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-cwd',
        ant_session_id: terminalId,
        hook_event_name: 'PostToolUse',
        cwd: '/Users/you/projB'
      })
    );
    expect(getTerminalById(terminalId)?.last_path).toBe('/Users/you/projB');
  });

  it('SessionStart captures the CLI session UUID + auto-mines boot_command when unset', async () => {
    const terminalId = seedTerminal('capture-start');
    createTerminalRecord({ sessionId: terminalId, name: 'speedyClaude', agentKind: 'claude_code' });
    appendTerminalRunEvent({
      terminalId, kind: 'raw', trust: 'raw',
      text: 'user@mac ~/proj $ claude --dangerously-skip-permissions --remote-control\n'
    });

    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-real-session-uuid',
        ant_session_id: terminalId,
        hook_event_name: 'SessionStart',
        source: 'startup'
      })
    );
    expect(response.status).toBe(201);

    const record = getTerminalRecord(terminalId);
    expect(record?.cli_session_id).toBe('claude-real-session-uuid');
    expect(record?.cli_session_source).toBe('claude-code');
    expect(record?.boot_command).toBe('claude --dangerously-skip-permissions --remote-control');
    expect(record?.boot_command_source).toBe('auto');
  });

  it('never clobbers an operator-set boot_command but still captures the resume target', async () => {
    const terminalId = seedTerminal('capture-operator');
    createTerminalRecord({
      sessionId: terminalId,
      name: 'operatorClaude',
      agentKind: 'claude_code',
      bootCommand: 'claude --operator-choice'
    });
    appendTerminalRunEvent({
      terminalId, kind: 'raw', trust: 'raw',
      text: '$ claude --something-else\n'
    });

    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-op',
        ant_session_id: terminalId,
        hook_event_name: 'SessionStart'
      })
    );

    const record = getTerminalRecord(terminalId);
    expect(record?.boot_command).toBe('claude --operator-choice');
    expect(record?.boot_command_source).toBe('operator');
    expect(record?.cli_session_id).toBe('claude-uuid-op');
  });

  it('refreshes an auto-captured boot_command + resume target on a later SessionStart', async () => {
    const terminalId = seedTerminal('capture-refresh');
    createTerminalRecord({ sessionId: terminalId, name: 'refreshClaude', agentKind: 'claude_code' });
    appendTerminalRunEvent({
      terminalId, kind: 'raw', trust: 'raw', text: '$ claude --first-launch\n'
    });
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-r1',
        ant_session_id: terminalId,
        hook_event_name: 'SessionStart'
      })
    );
    expect(getTerminalRecord(terminalId)?.boot_command).toBe('claude --first-launch');

    // Relaunch with different flags: the auto row refreshes, and the resume
    // target follows the NEW CLI session.
    appendTerminalRunEvent({
      terminalId, kind: 'raw', trust: 'raw', text: '$ claude --second-launch\n'
    });
    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-r2',
        ant_session_id: terminalId,
        hook_event_name: 'SessionStart'
      })
    );
    const record = getTerminalRecord(terminalId);
    expect(record?.boot_command).toBe('claude --second-launch');
    expect(record?.boot_command_source).toBe('auto');
    expect(record?.cli_session_id).toBe('claude-uuid-r2');
  });

  it('keeps the resume target fresh when the CLI session UUID drifts mid-stream (no SessionStart)', async () => {
    const terminalId = seedTerminal('capture-drift');
    createTerminalRecord({ sessionId: terminalId, name: 'driftClaude', agentKind: 'claude_code' });

    await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-d1',
        ant_session_id: terminalId,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash'
      })
    );
    expect(getTerminalRecord(terminalId)?.cli_session_id).toBe('claude-uuid-d1');
    // Mining only happens on SessionStart — a mid-stream event must not
    // touch boot_command.
    expect(getTerminalRecord(terminalId)?.boot_command).toBeNull();
  });

  it('capture is a no-op for an unresolvable terminal (no crash, event still persists)', async () => {
    const response = await runHandler(
      cliHookPost as unknown as AnyHandler,
      postBody('/api/cli-hook', {
        session_id: 'claude-uuid-orphan',
        hook_event_name: 'SessionStart',
        cwd: '/Users/you/somewhere'
      })
    );
    expect(response.status).toBe(201);
    expect(listCliHookEventsForSession('claude-uuid-orphan')).toHaveLength(1);
  });
});
