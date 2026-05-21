import { describe, expect, it } from 'vitest';
import { handleAgentsVerb } from './ant-cli-agents.mjs';

class CliInputError extends Error {}

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(captured.requests.length, { url, init });
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line),
    },
    captured,
  };
}

const okJson = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function fleetResponse() {
  return {
    agents: [
      {
        handle: '@evolveantclaude',
        model: 'claude',
        alive: true,
        currentRooms: [
          { roomId: 'jfeboje2kj', roomName: 'users', joinedAt: '1', lastActiveAt: '2', status: 'focused' },
          { roomId: '9xpgr36xdw', roomName: 'ops', joinedAt: '1', lastActiveAt: '2', status: 'focused' },
        ],
        currentTask: { id: 'task_acct_s9', planId: 'plan_x', title: 'something' },
        skills: ['general'],
      },
      {
        handle: '@codexlead1',
        model: 'codex',
        alive: true,
        currentRooms: [
          { roomId: '25dblwwtsx', roomName: 'svc', joinedAt: '1', lastActiveAt: null, status: 'idle' },
        ],
        currentTask: null,
        skills: ['code-gen'],
      },
      {
        handle: '@codexollama4',
        model: 'codex',
        alive: true,
        currentRooms: [],
        currentTask: null,
        skills: ['code-gen'],
      },
    ],
    summary: { total: 3, alive: 3, inRoom: 2, idle: 1, focused: 1 },
  };
}

describe('ant agents status', () => {
  it('S1: hits /api/agents/availability and prints a tabular roster', async () => {
    const { runtime, captured } = makeRuntime(() => okJson(fleetResponse()));
    const exit = await handleAgentsVerb('status', [], runtime, { CliInputError });
    expect(exit).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/agents/availability');
    // Header row.
    expect(captured.stdout[0]).toContain('HANDLE');
    expect(captured.stdout[0]).toContain('MODEL');
    // Body rows include the handle + rolled-up state + task id.
    const rows = captured.stdout.slice(1).join('\n');
    expect(rows).toContain('@evolveantclaude');
    expect(rows).toContain('focused');
    expect(rows).toContain('task_acct_s9');
    expect(rows).toContain('@codexlead1');
    // Summary footer.
    expect(captured.stdout[captured.stdout.length - 1]).toContain('3 agents');
  });

  it('S2: --json prints the raw response unchanged', async () => {
    const response = fleetResponse();
    const { runtime, captured } = makeRuntime(() => okJson(response));
    await handleAgentsVerb('status', ['--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(response);
  });

  it('S3: passes --idle / --model / --skill / --room as query params', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ agents: [], summary: { total: 0, alive: 0, inRoom: 0, idle: 0, focused: 0 } }));
    await handleAgentsVerb(
      'status',
      ['--idle', '--model', 'claude', '--skill', 'general', '--room', 'r1'],
      runtime,
      { CliInputError }
    );
    const url = new URL(captured.requests[0].url);
    expect(url.pathname).toBe('/api/agents/availability');
    expect(url.searchParams.get('inRoom')).toBe('false');
    expect(url.searchParams.get('model')).toBe('claude');
    expect(url.searchParams.get('skill')).toBe('general');
    expect(url.searchParams.get('roomId')).toBe('r1');
  });

  it('S4: --in-room sets inRoom=true', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ agents: [], summary: { total: 0, alive: 0, inRoom: 0, idle: 0, focused: 0 } }));
    await handleAgentsVerb('status', ['--in-room'], runtime, { CliInputError });
    const url = new URL(captured.requests[0].url);
    expect(url.searchParams.get('inRoom')).toBe('true');
  });

  it('S5: --idle and --in-room are mutually exclusive and reject before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleAgentsVerb('status', ['--idle', '--in-room'], runtime, { CliInputError })
    ).rejects.toThrow(/mutually exclusive/);
    expect(captured.requests).toHaveLength(0);
  });

  it('S6: empty roster prints a friendly "No agents." message', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ agents: [], summary: { total: 0, alive: 0, inRoom: 0, idle: 0, focused: 0 } }));
    await handleAgentsVerb('status', [], runtime, { CliInputError });
    expect(captured.stdout[0]).toBe('No agents.');
  });
});
