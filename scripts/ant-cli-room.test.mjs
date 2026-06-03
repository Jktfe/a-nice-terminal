import { describe, expect, it } from 'vitest';
import { handleRoomVerb } from './ant-cli-room.mjs';
import { makeCliRunner } from './ant-cli.mjs';

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

const okJson = (body, status = 200) => ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body) });
const bodyAt = (captured, index = 0) => JSON.parse(captured.requests[index].init.body);

describe('ant room admission wrappers', () => {
  it('R0a: positional add uses the clean SuperAdmin membership endpoint', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ handle: '@JWPK' }, 201));
    runtime.envTmuxPane = '%admin';
    runtime.config = { antSessions: { byPane: { '%admin': 'sess-admin' } } };
    await handleRoomVerb('s1hiftd05p', ['add', '@JWPK'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/s1hiftd05p/members/superadmin');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(captured.requests[0].init.headers['x-ant-session-id']).toBe('sess-admin');
    const body = bodyAt(captured);
    expect(body.handle).toBe('@JWPK');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout[0]).toContain('Member added: @JWPK');
  });

  it('R0b: positional remove uses the clean SuperAdmin membership endpoint', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ retiredAs: '@JWPK-1' }, 200));
    await handleRoomVerb('s1hiftd05p', ['remove', '@JWPK'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/s1hiftd05p/members/superadmin');
    expect(captured.requests[0].init.method).toBe('DELETE');
    const body = bodyAt(captured);
    expect(body.handle).toBe('@JWPK');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout[0]).toContain('Member removed: @JWPK');
  });

  it('R1: members lists room members and supports --json', async () => {
    const room = { members: [{ handle: '@researchant', kind: 'agent', joinedAt: 'now' }] };
    const { runtime, captured } = makeRuntime(() => okJson({ chatRoom: room }));
    await handleRoomVerb('members', ['--room', 'room-a'], runtime, { CliInputError });
    await handleRoomVerb('members', ['--room', 'room-a', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a');
    expect(captured.stdout[0]).toContain('@researchant');
    expect(JSON.parse(captured.stdout[1]).chatRoom.members[0].handle).toBe('@researchant');
  });

  it('R2: add-member POSTs agentHandle + display name + pidChain (M3.6a-v1 T3)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ chatRoom: { id: 'room-a' } }, 201));
    await handleRoomVerb('add-member', ['--room', 'room-a', '--handle', '@codex', '--display-name', 'Codex'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/members');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(body).toMatchObject({ agentHandle: '@codex', agentDisplayName: 'Codex' });
    expect(Array.isArray(body.pidChain)).toBe(true);
  });

  it('R3: remove-member DELETEs by encoded globalHandle + JSON-body pidChain (transport-lock)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}, 204));
    await handleRoomVerb('remove-member', ['--room', 'room-a', '--handle', '@codex'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/members?globalHandle=%40codex');
    expect(captured.requests[0].init.method).toBe('DELETE');
    const body = bodyAt(captured);
    expect(Array.isArray(body.pidChain)).toBe(true);
  });

  it('R4: aliases list, set-alias, and clear-alias hit the alias routes', async () => {
    const replies = [
      okJson({ aliases: [{ globalHandle: '@codex', alias: '@cdx' }] }),
      okJson({ aliasEntry: { globalHandle: '@codex', alias: '@cdx' } }, 201),
      okJson({}, 204)
    ];
    const { runtime, captured } = makeRuntime((index) => replies[index - 1]);
    await handleRoomVerb('aliases', ['--room', 'room-a'], runtime, { CliInputError });
    await handleRoomVerb('set-alias', ['--room', 'room-a', '--handle', '@codex', '--alias', '@cdx'], runtime, { CliInputError });
    await handleRoomVerb('clear-alias', ['--room', 'room-a', '--handle', '@codex'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/aliases');
    expect(captured.requests[1].init.method).toBe('POST');
    expect(bodyAt(captured, 1)).toMatchObject({ globalHandle: '@codex', newAlias: '@cdx' });
    expect(captured.requests[2].url).toContain('globalHandle=%40codex');
    expect(captured.requests[2].init.method).toBe('DELETE');
  });

  it('R5: required flags fail before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleRoomVerb('members', [], runtime, { CliInputError })).rejects.toThrow('missing required flag --room');
    await expect(handleRoomVerb('set-alias', ['--room', 'room-a', '--handle', '@codex'], runtime, { CliInputError })).rejects.toThrow('missing required flag --alias');
    expect(captured.requests).toHaveLength(0);
  });

  it('R6: main runner dispatches the room primary verb', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ aliases: [] });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['room', 'aliases', '--room', 'room-a']);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/chat-rooms/room-a/aliases');
  });
});

describe('ant room mode', () => {
  it('M1: read prints current mode (text + --json)', async () => {
    const reply = okJson({ roomId: 'room-a', mode: 'brainstorm', set_by: null, set_at: null });
    const { runtime, captured } = makeRuntime(() => reply);
    await handleRoomVerb('mode', ['--room', 'room-a'], runtime, { CliInputError });
    await handleRoomVerb('mode', ['--room', 'room-a', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/mode');
    expect(captured.requests[0].init.method).toBeUndefined();
    expect(captured.stdout[0]).toContain('brainstorm');
    expect(JSON.parse(captured.stdout[1]).mode).toBe('brainstorm');
  });

  // Each --set call resolves processIdentityChain by walking the live process
  // tree (~1.8s on macOS), so per-mode tests stay under the 5s default rather
  // than looping all three in one block.
  it('M2a: --set brainstorm PUTs mode + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', mode: 'brainstorm', set_by: '@a', set_at: 1 }));
    await handleRoomVerb('mode', ['--room', 'r', '--set', 'brainstorm'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(bodyAt(captured).mode).toBe('brainstorm');
    expect(Array.isArray(bodyAt(captured).pidChain)).toBe(true);
  });
  it('M2b: --set heads-down PUTs mode + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', mode: 'heads-down', set_by: '@a', set_at: 1 }));
    await handleRoomVerb('mode', ['--room', 'r', '--set', 'heads-down'], runtime, { CliInputError });
    expect(bodyAt(captured).mode).toBe('heads-down');
  });
  it('M2c: --set closed PUTs mode + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', mode: 'closed', set_by: '@a', set_at: 1 }));
    await handleRoomVerb('mode', ['--room', 'r', '--set', 'closed'], runtime, { CliInputError });
    expect(bodyAt(captured).mode).toBe('closed');
  });

  it('M3: --set rejects unknown mode values before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleRoomVerb('mode', ['--room', 'r', '--set', 'mute'], runtime, { CliInputError })
    ).rejects.toThrow(/--set must be one of/);
    expect(captured.requests).toHaveLength(0);
  });

  it('M4: --toggle from brainstorm issues PUT for heads-down', async () => {
    const replies = [
      okJson({ roomId: 'r', mode: 'brainstorm', set_by: null, set_at: null }),
      okJson({ roomId: 'r', mode: 'heads-down', set_by: '@a', set_at: 2 })
    ];
    const { runtime, captured } = makeRuntime((i) => replies[i - 1]);
    await handleRoomVerb('mode', ['--room', 'r', '--toggle'], runtime, { CliInputError });
    expect(captured.requests).toHaveLength(2);
    expect(captured.requests[1].init.method).toBe('PUT');
    expect(bodyAt(captured, 1).mode).toBe('heads-down');
  });

  it('M5: --toggle from heads-down issues PUT for brainstorm', async () => {
    const replies = [
      okJson({ roomId: 'r', mode: 'heads-down', set_by: '@a', set_at: 1 }),
      okJson({ roomId: 'r', mode: 'brainstorm', set_by: '@a', set_at: 2 })
    ];
    const { runtime, captured } = makeRuntime((i) => replies[i - 1]);
    await handleRoomVerb('mode', ['--room', 'r', '--toggle'], runtime, { CliInputError });
    expect(bodyAt(captured, 1).mode).toBe('brainstorm');
  });

  it('M6: --toggle while closed REFUSES with exit 1 + stderr, no PUT', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', mode: 'closed', set_by: '@a', set_at: 1 }));
    const exitCode = await handleRoomVerb('mode', ['--room', 'r', '--toggle'], runtime, { CliInputError });
    expect(exitCode).toBe(1);
    expect(captured.stderr[0]).toMatch(/Room is closed/);
    expect(captured.stderr[0]).toMatch(/--set brainstorm/);
    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0].init.method).toBeUndefined();
  });

  it('M7: --set and --toggle are mutually exclusive', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleRoomVerb('mode', ['--room', 'r', '--set', 'closed', '--toggle'], runtime, { CliInputError })
    ).rejects.toThrow(/mutually exclusive/);
    expect(captured.requests).toHaveLength(0);
  });

  it('M8: main runner dispatches `ant room mode --room ... --set heads-down`', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ roomId: 'r', mode: 'heads-down', set_by: '@a', set_at: 1 });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['room', 'mode', '--room', 'r', '--set', 'heads-down']);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/chat-rooms/r/mode');
    expect(calls[0].init.method).toBe('PUT');
  });
});

// `ant room responders` tests moved to scripts/ant-cli-room-responders.test.mjs
// to keep this file under the 240L soft cap once admission + mode + responders
// all landed on the same handler.
