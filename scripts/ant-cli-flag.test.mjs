/**
 * ant flag CLI tests — file-refs subsystem (JWPK 2026-05-16).
 *
 * Stubs fetch and asserts the URL/body sent for add/list/remove and the
 * terminal listfiles wrapper.
 */

import { describe, expect, it } from 'vitest';
import { handleFlagVerb } from './ant-cli-flag.mjs';
import { handleTerminalVerb } from './ant-cli-terminal.mjs';

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

const noContent = () => ({ ok: true, status: 204, json: async () => ({}), text: async () => '' });

const terminalsListPayload = {
  terminals: [
    {
      sessionId: 't_codex_abc',
      name: 'codex',
      handle: '@codex',
      derivedHandle: '@codex',
      agentKind: 'codex',
      linkedChatRoomId: null,
      tmuxTargetPane: 't_codex_abc:0.0',
      alive: true
    }
  ]
};

const chatRoomsListPayload = {
  chatRooms: [
    { id: 'room_alpha', name: 'antDevTeam', members: [] }
  ]
};

describe('ant flag CLI', () => {
  it('flag add (global by default) posts to /api/file-refs with scope=global', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ fileRef: { id: 'r1', filePath: 'a.ts', scope: 'global', scopeTarget: null } }, 201));
    const code = await handleFlagVerb('add', ['a.ts', '--label', 'hello'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/file-refs');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body).toMatchObject({ file_path: 'a.ts', scope: 'global', scope_target: null, label: 'hello' });
    expect(captured.stdout[0]).toContain('r1');
    expect(captured.stdout[0]).toContain('[global]');
  });

  it('flag add --terminal resolves the name to a sessionId via /api/terminals first', async () => {
    const responses = [terminalsListPayload, { fileRef: { id: 'r2', filePath: 'x.ts', scope: 'terminal', scopeTarget: 't_codex_abc' } }];
    const { runtime, captured } = makeRuntime((n) => okJson(responses[n - 1], n === 2 ? 201 : 200));
    const code = await handleFlagVerb('add', ['x.ts', '--terminal', 'codex'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals');
    expect(captured.requests[1].url).toBe('http://test.local/api/file-refs');
    const body = JSON.parse(captured.requests[1].init.body);
    expect(body).toMatchObject({ scope: 'terminal', scope_target: 't_codex_abc' });
  });

  it('flag add rejects both --terminal and --chat', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleFlagVerb('add', ['x.ts', '--terminal', 'codex', '--chat', 'antDevTeam'], runtime, { CliInputError })
    ).rejects.toThrow(/terminal OR --chat/);
  });

  it('flag list --terminal resolves and GETs the right query string', async () => {
    const responses = [terminalsListPayload, { fileRefs: [{ id: 'r1', filePath: 'a.ts', scope: 'terminal', scopeTarget: 't_codex_abc', label: null }] }];
    const { runtime, captured } = makeRuntime((n) => okJson(responses[n - 1]));
    await handleFlagVerb('list', ['--terminal', 'codex'], runtime, { CliInputError });
    expect(captured.requests[1].url).toBe('http://test.local/api/file-refs?scope=terminal&target=t_codex_abc');
    expect(captured.stdout[0]).toContain('a.ts');
  });

  it('flag list --chat resolves and GETs the right query string', async () => {
    const responses = [chatRoomsListPayload, { fileRefs: [] }];
    const { runtime, captured } = makeRuntime((n) => okJson(responses[n - 1]));
    await handleFlagVerb('list', ['--chat', 'antDevTeam'], runtime, { CliInputError });
    expect(captured.requests[1].url).toBe('http://test.local/api/file-refs?scope=chatroom&target=room_alpha');
    expect(captured.stdout[0]).toContain('no file-refs');
  });

  it('flag list --path encodes and goes straight to the path query', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ fileRefs: [] }));
    await handleFlagVerb('list', ['--path', './x y.ts'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/file-refs?path=.%2Fx%20y.ts');
  });

  it('flag remove sends DELETE /api/file-refs/<id>', async () => {
    const { runtime, captured } = makeRuntime(() => noContent());
    await handleFlagVerb('remove', ['ref-id-123'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/file-refs/ref-id-123');
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(captured.stdout[0]).toContain('ref-id-123');
  });

  it('terminal <name> listfiles resolves name then GETs /api/terminals/<id>/files', async () => {
    const responses = [terminalsListPayload, { fileRefs: [{ id: 'r9', filePath: 'k.ts', label: 'k', scope: 'terminal', scopeTarget: 't_codex_abc' }] }];
    const { runtime, captured } = makeRuntime((n) => okJson(responses[n - 1]));
    const code = await handleTerminalVerb('codex', ['listfiles'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[1].url).toBe('http://test.local/api/terminals/t_codex_abc/files');
    expect(captured.stdout[0]).toContain('k.ts');
  });

  it('flag add with --terminal but unknown name throws via the resolver', async () => {
    const { runtime } = makeRuntime(() => okJson({ terminals: [] }));
    await expect(
      handleFlagVerb('add', ['x.ts', '--terminal', 'ghost'], runtime, { CliInputError })
    ).rejects.toThrow(/no terminal matching/);
  });
});
