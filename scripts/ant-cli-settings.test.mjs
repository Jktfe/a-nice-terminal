import { describe, expect, it } from 'vitest';
import { handleSettingsVerb } from './ant-cli-settings.mjs';

class CliInputError extends Error {}

/**
 * makeRuntime — bundles a tiny dispatchable mock for runtime.fetchImpl.
 * routes is an array of { match: (url, init) => bool, respond: (req) => res }.
 * First matching route wins; later routes can be overridden in-place.
 */
function makeRuntime(routes) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    for (const route of routes) {
      if (route.match(url, init)) {
        return route.respond({ url, init });
      }
    }
    throw new Error(`no mock route for ${init.method ?? 'GET'} ${url}`);
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

const okJson = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const okNoBody = (status = 204) => ({
  ok: true,
  status,
  json: async () => ({}),
  text: async () => ''
});

const bodyAt = (captured, index) => JSON.parse(captured.requests[index].init.body);

const terminalsResponse = {
  terminals: [
    { sessionId: 't_abc', name: 'antkimi', handle: '@antkimi', derivedHandle: '@antkimi' }
  ]
};
const chatRoomsResponse = {
  chatRooms: [
    { id: 'room_x', name: 'antDevTeam' }
  ]
};

describe('ant settings CLI', () => {
  it('addterminalshortcut: resolves --terminal then POSTs scope=terminal with scope_target', async () => {
    const { runtime, captured } = makeRuntime([
      {
        match: (url, init) => url.endsWith('/api/terminals') && (init.method ?? 'GET') === 'GET',
        respond: () => okJson(terminalsResponse)
      },
      {
        match: (url, init) => url.endsWith('/api/shortcuts') && init.method === 'POST',
        respond: () => okJson({ shortcut: { id: 'sc_1', label: 'plan' } }, 201)
      }
    ]);
    await handleSettingsVerb(
      'addterminalshortcut',
      ['--terminal', 'antkimi', '--label', 'plan', '--command', '/plan'],
      runtime,
      { CliInputError }
    );
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals');
    expect(captured.requests[1].url).toBe('http://test.local/api/shortcuts');
    expect(captured.requests[1].init.method).toBe('POST');
    const body = bodyAt(captured, 1);
    expect(body.scope).toBe('terminal');
    expect(body.scope_target).toBe('t_abc');
    expect(body.label).toBe('plan');
    expect(body.command).toBe('/plan');
    expect(captured.stdout.join(' ')).toMatch(/Added terminal shortcut sc_1/);
  });

  it('addchatroomshortcut: resolves --chat by name then POSTs scope=chatroom', async () => {
    const { runtime, captured } = makeRuntime([
      {
        match: (url) => new URL(url).pathname === '/api/chat-rooms',
        respond: () => okJson(chatRoomsResponse)
      },
      {
        match: (url, init) => url.endsWith('/api/shortcuts') && init.method === 'POST',
        respond: () => okJson({ shortcut: { id: 'sc_2', label: 'sync' } }, 201)
      }
    ]);
    await handleSettingsVerb(
      'addchatroomshortcut',
      ['--chat', 'antDevTeam', '--label', 'sync', '--command', 'sync now'],
      runtime,
      { CliInputError }
    );
    const body = bodyAt(captured, 1);
    expect(body.scope).toBe('chatroom');
    expect(body.scope_target).toBe('room_x');
    expect(body.label).toBe('sync');
    expect(body.command).toBe('sync now');
    expect(captured.stdout.join(' ')).toMatch(/Added chatroom shortcut sc_2/);
  });

  it('addterminalshortcut: throws CliInputError when --label missing', async () => {
    const { runtime } = makeRuntime([]);
    await expect(
      handleSettingsVerb(
        'addterminalshortcut',
        ['--terminal', 'antkimi', '--command', '/plan'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/missing required flag --label/);
  });

  it('listshortcuts: no flag → GET /api/shortcuts?scope=global', async () => {
    const { runtime, captured } = makeRuntime([
      {
        match: (url) => url.startsWith('http://test.local/api/shortcuts?'),
        respond: () =>
          okJson({
            shortcuts: [
              { id: 'g1', label: 'help', command: '/help' }
            ]
          })
      }
    ]);
    await handleSettingsVerb('listshortcuts', [], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/shortcuts?scope=global');
    const out = captured.stdout.join('\n');
    expect(out).toMatch(/Shortcuts for global/);
    expect(out).toMatch(/g1\s+help\s+\/help/);
  });

  it('listshortcuts: --terminal NAME → resolves then GET scope=terminal&target=<id>', async () => {
    const { runtime, captured } = makeRuntime([
      {
        match: (url) => url.endsWith('/api/terminals'),
        respond: () => okJson(terminalsResponse)
      },
      {
        match: (url) => url.startsWith('http://test.local/api/shortcuts?'),
        respond: () => okJson({ shortcuts: [] })
      }
    ]);
    await handleSettingsVerb(
      'listshortcuts',
      ['--terminal', 'antkimi'],
      runtime,
      { CliInputError }
    );
    expect(captured.requests[1].url).toBe(
      'http://test.local/api/shortcuts?scope=terminal&target=t_abc'
    );
    expect(captured.stdout.join('\n')).toMatch(/No shortcuts for terminal antkimi\./);
  });

  it('listshortcuts: --terminal and --chat together throws CliInputError', async () => {
    const { runtime } = makeRuntime([]);
    await expect(
      handleSettingsVerb(
        'listshortcuts',
        ['--terminal', 'antkimi', '--chat', 'antDevTeam'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/at most one of --terminal or --chat/);
  });

  it('listshortcuts: --json emits the raw envelope', async () => {
    const envelope = { shortcuts: [{ id: 'g1', label: 'help', command: '/help' }] };
    const { runtime, captured } = makeRuntime([
      {
        match: (url) => url.startsWith('http://test.local/api/shortcuts?'),
        respond: () => okJson(envelope)
      }
    ]);
    await handleSettingsVerb('listshortcuts', ['--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(envelope);
  });

  it('removeshortcut: DELETE /api/shortcuts/<id> and prints confirmation', async () => {
    const { runtime, captured } = makeRuntime([
      {
        match: (url, init) =>
          url === 'http://test.local/api/shortcuts/sc_1' && init.method === 'DELETE',
        respond: () => okNoBody(204)
      }
    ]);
    await handleSettingsVerb('removeshortcut', ['sc_1'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(captured.requests[0].url).toBe('http://test.local/api/shortcuts/sc_1');
    expect(captured.stdout.join(' ')).toMatch(/Removed shortcut sc_1/);
  });

  it('removeshortcut: missing id positional throws CliInputError', async () => {
    const { runtime } = makeRuntime([]);
    await expect(
      handleSettingsVerb('removeshortcut', [], runtime, { CliInputError })
    ).rejects.toThrow(/needs a shortcut id positional/);
  });

  it('unknown settings verb throws CliInputError', async () => {
    const { runtime } = makeRuntime([]);
    await expect(
      handleSettingsVerb('frobnicate', [], runtime, { CliInputError })
    ).rejects.toThrow(/unknown settings verb/);
  });
});
