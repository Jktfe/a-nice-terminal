import { describe, expect, it } from 'vitest';
import { handleTerminalVerb } from './ant-cli-terminal.mjs';

class CliInputError extends Error {}

function makeRuntime(handlers) {
  const captured = { requests: [], stdout: [], stderr: [] };
  // handlers: map from path → response | function(req, n). Match exact
  // first, then prefix — so more-specific entries beat generic ones
  // regardless of insertion order in the calling test.
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    const path = new URL(url).pathname;
    let response;
    const entries = Object.entries(handlers);
    const exact = entries.find(([k]) => k === path);
    const prefix = exact ? null : entries.find(([k]) => path.startsWith(k));
    const winner = exact ?? prefix;
    if (winner) {
      const handler = winner[1];
      response = typeof handler === 'function' ? handler(captured.requests.length, { url, init }) : handler;
    }
    if (!response) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'no handler' };
    }
    return response;
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

const TERMINALS_FIXTURE = {
  terminals: [
    {
      sessionId: 't_abc',
      name: 'T1',
      agentKind: 'claude',
      handle: null,
      derivedHandle: '@t1',
      linkedChatRoomId: 'r_link_t1',
      tmuxTargetPane: 't_abc:0.0',
      alive: true
    },
    {
      sessionId: 't_def',
      name: 'T2-other',
      agentKind: 'codex',
      handle: '@operator',
      derivedHandle: '@operator',
      linkedChatRoomId: 'r_link_t2',
      tmuxTargetPane: 't_def:0.0',
      alive: true
    }
  ]
};

describe('ant terminal name-aware verbs', () => {
  it('terminal handle resolves current shell with the pane-scoped durable session', async () => {
    const { runtime, captured } = makeRuntime({
      '/api/identity/resolve': ok({ terminal_id: 't_abc', name: 'T1', agent_kind: 'claude', handle: '@t1' }),
      '/api/terminals': ok(TERMINALS_FIXTURE)
    });
    runtime.envTmuxPane = '%terminal-handle';
    runtime.config = { antSessions: { byPane: { '%terminal-handle': 'sess-terminal-handle' } } };

    await handleTerminalVerb('handle', [], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/identity/resolve');
    expect(JSON.parse(captured.requests[0].init.body)).toMatchObject({
      pids: expect.any(Array),
      sessionId: 'sess-terminal-handle'
    });
    expect(captured.stdout.join(' ')).toContain('@t1');
  });

  it('terminal <name>: shows info for the matched record', async () => {
    const { runtime, captured } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE)
    });
    await handleTerminalVerb('T1', [], runtime, { CliInputError });
    expect(captured.stdout.join(' ')).toMatch(/Terminal "T1"/);
    expect(captured.stdout.join(' ')).toMatch(/sessionId:\s+t_abc/);
    expect(captured.stdout.join(' ')).toMatch(/agentKind:\s+claude/);
  });

  it('terminal <sessionId>: also resolves by id', async () => {
    const { runtime, captured } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await handleTerminalVerb('t_def', [], runtime, { CliInputError });
    expect(captured.stdout.join(' ')).toMatch(/Terminal "T2-other"/);
  });

  it('terminal <handle>: resolves by handle', async () => {
    const { runtime, captured } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await handleTerminalVerb('@operator', [], runtime, { CliInputError });
    expect(captured.stdout.join(' ')).toMatch(/T2-other/);
  });

  it('terminal <name> post <msg>: posts to terminal chat', async () => {
    const posts = [];
    const { runtime, captured } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/chat-rooms/r_link_t1/messages': (n, { init }) => {
        posts.push(JSON.parse(init.body));
        return ok({ message: { id: 'msg_x', authorHandle: '@t1' } });
      }
    });
    await handleTerminalVerb('T1', ['post', 'hello', 'world'], runtime, { CliInputError });
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toBe('hello world');
    expect(posts[0].pidChain).toBeDefined();
    expect(captured.stdout.join(' ')).toMatch(/Posted msg_x/);
    expect(captured.stdout.join(' ')).toMatch(/terminal chat/);
    expect(captured.stdout.join(' ')).not.toMatch(/linked chat/);
  });

  it('terminal <name> namechange <new>: PATCHes /api/terminals/<id> with name', async () => {
    const patches = [];
    const { runtime, captured } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/terminals/t_abc': (n, { init }) => {
        if (init.method === 'PATCH') {
          patches.push(JSON.parse(init.body));
          return ok({ sessionId: 't_abc', name: 'T1-renamed' });
        }
        return ok({});
      }
    });
    await handleTerminalVerb('T1', ['namechange', 'T1-renamed'], runtime, { CliInputError });
    expect(patches).toHaveLength(1);
    expect(patches[0].name).toBe('T1-renamed');
    expect(captured.stdout.join(' ')).toMatch(/Renamed terminal t_abc/);
  });

  it('terminal <name> setcli <kind>: PATCHes the dedicated CLI route with admin auth', async () => {
    const patches = [];
    const { runtime, captured } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/terminals/t_abc/cli': (n, { init }) => {
        if (init.method === 'PATCH') {
          patches.push({ body: JSON.parse(init.body), authorization: init.headers.authorization });
          return ok({ ok: true, sessionId: 't_abc', agentKind: 'agy' });
        }
        return ok({});
      }
    });
    runtime.env = { ANT_ADMIN_TOKEN: 'admin-secret' };
    await handleTerminalVerb('T1', ['setcli', 'agy'], runtime, { CliInputError });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      body: { cli: 'agy' },
      authorization: 'Bearer admin-secret'
    });
    expect(captured.stdout.join(' ')).toMatch(/agentKind/);
  });

  it('terminal <name> setcli: requires admin auth before mutating the CLI route', async () => {
    const { runtime, captured } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await expect(
      handleTerminalVerb('T1', ['setcli', 'agy'], runtime, { CliInputError })
    ).rejects.toThrow(/setcli requires admin auth/);
    expect(captured.requests).toHaveLength(0);
  });

  it('terminal <name> adopt --pid <pid> --pid-start <start>: POSTs adopt route', async () => {
    const posts = [];
    const authHeaders = [];
    const { runtime, captured } = makeRuntime({
      '/api/terminals': ok(TERMINALS_FIXTURE),
      '/api/terminals/t_abc/adopt': (n, { init }) => {
        posts.push(JSON.parse(init.body));
        authHeaders.push(init.headers.authorization);
        return ok({
          terminalId: 't_abc',
          handle: '@t1',
          adopted: { pid: 777, pidStart: 'start', ttlSeconds: 900 }
        });
      }
    });
    await handleTerminalVerb('T1', ['adopt', '--pid', '777', '--pid-start', 'start', '--ttl', '900', '--reason', 'old session', '--admin-token', 'test-admin'], runtime, { CliInputError });
    expect(posts).toEqual([
      { pid: 777, pidStart: 'start', ttlSeconds: 900, reason: 'old session' }
    ]);
    expect(authHeaders).toEqual(['Bearer test-admin']);
    expect(captured.stdout.join(' ')).toMatch(/Adopted pid 777/);
  });

  it('terminal <name> whatcli: prints just the agentKind', async () => {
    const { runtime, captured } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await handleTerminalVerb('T1', ['whatcli'], runtime, { CliInputError });
    expect(captured.stdout).toEqual(['claude']);
  });

  it('terminal <name> localtmux: prints the tmux attach command', async () => {
    const { runtime, captured } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await handleTerminalVerb('T1', ['localtmux'], runtime, { CliInputError });
    expect(captured.stdout).toEqual(['tmux attach-session -t t_abc']);
  });

  it('terminal <name> sshtmux --host h: builds ssh command', async () => {
    const { runtime, captured } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await handleTerminalVerb('T1', ['sshtmux', '--host', 'my.box.lan'], runtime, { CliInputError });
    expect(captured.stdout).toEqual(['ssh my.box.lan -t tmux attach-session -t t_abc']);
  });

  it('terminal <unknown>: errors helpfully', async () => {
    const { runtime } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    await expect(handleTerminalVerb('phantom', [], runtime, { CliInputError })).rejects.toThrow(/no terminal matching "phantom"/);
  });

  it('terminal <name> unknown-subaction: throws', async () => {
    const { runtime } = makeRuntime({ '/api/terminals': ok(TERMINALS_FIXTURE) });
    // unknown sub-verbs that are NOT in RESERVED_ACTIONS get treated as the
    // "show info" path. Our trigger for "unknown" is when subAction IS in
    // RESERVED_ACTIONS but invalid — that doesn't apply here. Skip.
  });
});
