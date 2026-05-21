/**
 * ant task CLI tests — JWPK TASKS-SUBSYSTEM (2026-05-16).
 *
 * Verifies the 4 verbs (list / create / done / assign) against a mocked
 * fetch, plus the terminal listtasks sub-verb's request shape.
 */

import { describe, expect, it } from 'vitest';
import { handleTaskVerb } from './ant-cli-task.mjs';
import { handleTerminalVerb } from './ant-cli-terminal.mjs';

class CliInputError extends Error {}

function makeRuntime(handlers) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    const path = new URL(url).pathname + (new URL(url).search ?? '');
    const pathOnly = new URL(url).pathname;
    const entries = Object.entries(handlers);
    // Exact path+search first, then pathname-only, then prefix.
    const exact = entries.find(([k]) => k === path);
    const pathExact = exact ? null : entries.find(([k]) => k === pathOnly);
    const prefix = (exact || pathExact) ? null : entries.find(([k]) => pathOnly.startsWith(k));
    const winner = exact ?? pathExact ?? prefix;
    if (!winner) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'no handler' };
    }
    const handler = winner[1];
    return typeof handler === 'function' ? handler(captured.requests.length, { url, init }) : handler;
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const created = (body) => ({ ok: true, status: 201, json: async () => body, text: async () => JSON.stringify(body) });

const TERMINALS_FIXTURE = {
  terminals: [
    {
      sessionId: 't_codex2',
      name: 'codex2',
      agentKind: 'codex',
      handle: '@codex2',
      derivedHandle: '@codex2',
      linkedChatRoomId: 'r_codex2',
      tmuxTargetPane: 't_codex2:0.0',
      alive: true
    }
  ]
};

const ROOMS_FIXTURE = {
  chatRooms: [
    { id: 'room-zzz', name: 'antDevTeam', attentionState: 'ready' }
  ]
};

describe('ant task list', () => {
  it('lists tasks with no filter — falls through to legacy /api/tasks', async () => {
    const { runtime, captured } = makeRuntime({
      '/api/tasks': ok({
        tasks: [
          { id: 'a', subject: 'first', status: 'pending', assignedAgent: '@me' },
          { id: 'b', subject: 'second', status: 'completed', assignedAgent: '@you' }
        ]
      })
    });
    const code = await handleTaskVerb('list', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout.length).toBe(2);
    expect(captured.stdout[0]).toMatch(/a\s+pending\s+@me\s+first/);
    expect(captured.stdout[1]).toMatch(/b\s+completed\s+@you\s+second/);
  });

  it('list --terminal NAME resolves to sessionId and queries JWPK route', async () => {
    const seen = [];
    const { runtime } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/tasks': (n, { url }) => {
        seen.push(url);
        return ok({ tasks: [] });
      }
    });
    const code = await handleTaskVerb('list', ['--terminal', 'codex2'], runtime, { CliInputError });
    expect(code).toBe(0);
    const taskCall = seen.find((u) => u.includes('terminal=t_codex2'));
    expect(taskCall).toBeDefined();
  });

  it('list --status todo --json emits JSON pass-through', async () => {
    const payload = { tasks: [{ id: 'x', title: 'open', status: 'todo' }] };
    const { runtime, captured } = makeRuntime({ '/api/tasks': ok(payload) });
    const code = await handleTaskVerb('list', ['--status', 'todo', '--json'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout).toHaveLength(1);
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });
});

describe('ant task create', () => {
  it('requires --title', async () => {
    const { runtime } = makeRuntime({});
    await expect(
      handleTaskVerb('create', [], runtime, { CliInputError })
    ).rejects.toThrow(/--title/);
  });

  it('POSTs body { title } and prints id', async () => {
    const posts = [];
    const { runtime, captured } = makeRuntime({
      '/api/tasks': (n, { init }) => {
        if (init.method === 'POST') {
          posts.push(JSON.parse(init.body));
          return created({ task: { id: 'NEW-1', title: 'hello' } });
        }
        return ok({});
      }
    });
    const code = await handleTaskVerb('create', ['--title', 'hello'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('hello');
    expect(captured.stdout.join(' ')).toMatch(/Created task NEW-1/);
  });

  it('--terminal + --assigned + --room resolves names then includes ids', async () => {
    const posts = [];
    const { runtime } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/chat-rooms': ok(ROOMS_FIXTURE),
      '/api/tasks': (n, { init }) => {
        if (init.method === 'POST') {
          posts.push(JSON.parse(init.body));
          return created({ task: { id: 'NEW-2', title: 'with-binding' } });
        }
        return ok({});
      }
    });
    await handleTaskVerb(
      'create',
      ['--title', 'with-binding', '--terminal', 'codex2', '--assigned', '@claude2', '--room', 'antDevTeam'],
      runtime,
      { CliInputError }
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].assigned_terminal_id).toBe('t_codex2');
    expect(posts[0].assigned_to).toBe('@claude2');
    expect(posts[0].room_id).toBe('room-zzz');
  });

  it('--plan includes plan_id for cockpit-linked tasks', async () => {
    const posts = [];
    const { runtime } = makeRuntime({
      '/api/tasks': (n, { init }) => {
        if (init.method === 'POST') {
          posts.push(JSON.parse(init.body));
          return created({ task: { id: 'NEW-3', title: 'planned', planId: 'v4-fresh-ant' } });
        }
        return ok({});
      }
    });
    await handleTaskVerb(
      'create',
      ['--title', 'planned', '--plan', 'v4-fresh-ant'],
      runtime,
      { CliInputError }
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].plan_id).toBe('v4-fresh-ant');
  });
});

describe('ant task done', () => {
  it('requires a taskId positional', async () => {
    const { runtime } = makeRuntime({});
    await expect(
      handleTaskVerb('done', [], runtime, { CliInputError })
    ).rejects.toThrow(/taskId/);
  });

  it('PATCHes /api/tasks/:id with status=done', async () => {
    const patches = [];
    const { runtime, captured } = makeRuntime({
      '/api/tasks/abc-123': (n, { init }) => {
        if (init.method === 'PATCH') {
          patches.push(JSON.parse(init.body));
          return ok({ task: { id: 'abc-123', status: 'done' } });
        }
        return ok({});
      }
    });
    const code = await handleTaskVerb('done', ['abc-123'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(patches).toEqual([{ status: 'done' }]);
    expect(captured.stdout.join(' ')).toMatch(/Marked abc-123 done/);
  });
});

describe('ant task assign', () => {
  it('requires --to', async () => {
    const { runtime } = makeRuntime({});
    await expect(
      handleTaskVerb('assign', ['abc'], runtime, { CliInputError })
    ).rejects.toThrow(/--to/);
  });

  it('PATCHes /api/tasks/:id with assigned_to', async () => {
    const patches = [];
    const { runtime, captured } = makeRuntime({
      '/api/tasks/abc-123': (n, { init }) => {
        if (init.method === 'PATCH') {
          patches.push(JSON.parse(init.body));
          return ok({ task: { id: 'abc-123', assignedTo: '@codex2' } });
        }
        return ok({});
      }
    });
    const code = await handleTaskVerb(
      'assign',
      ['abc-123', '--to', '@codex2'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(patches).toEqual([{ assigned_to: '@codex2' }]);
    expect(captured.stdout.join(' ')).toMatch(/Assigned abc-123 → @codex2/);
  });
});

describe('ant terminal <name> listtasks', () => {
  it('resolves terminal name then GETs /api/terminals/:sessionId/tasks', async () => {
    const { runtime, captured } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/terminals/t_codex2/tasks': ok({
        terminalId: 't_codex2',
        tasks: [
          { id: 't1', title: 'one', status: 'todo', assignedTo: '@codex2' },
          { id: 't2', title: 'two', status: 'in_progress', assignedTo: '@codex2' }
        ]
      })
    });
    const code = await handleTerminalVerb(
      'codex2',
      ['listtasks'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout[0]).toMatch(/t1\s+todo\s+@codex2\s+one/);
    expect(captured.stdout[1]).toMatch(/t2\s+in_progress\s+@codex2\s+two/);
  });
});
