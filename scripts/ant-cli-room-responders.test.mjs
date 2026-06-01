// CLI tests for `ant room responders` subverb (M3.b.5).
// Split out of scripts/ant-cli-room.test.mjs to keep that file under the 240L
// soft cap once admission (M3.b.2) + mode (M3.b.4) + responders (M3.b.5) all
// landed on the same handler.
import { describe, expect, it } from 'vitest';
import { handleRoomVerb } from './ant-cli-room.mjs';

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

describe('ant room responders (M3.b.5)', () => {
  it('R1: list prints handle + pane_status', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', responders: [{ order_index: 1000, handle: '@a', pane_status: 'verified' }] }));
    await handleRoomVerb('responders', ['--room', 'r'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/r/responders');
    expect(captured.stdout[0]).toContain('@a');
    expect(captured.stdout[0]).toContain('verified');
  });
  it('R2: --set issues PUT with handles + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', responders: [{ handle: '@a' }, { handle: '@b' }] }));
    await handleRoomVerb('responders', ['--room', 'r', '--set', '@a,@b'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(bodyAt(captured)).toMatchObject({ handles: ['@a', '@b'] });
    expect(Array.isArray(bodyAt(captured).pidChain)).toBe(true);
  });
  it('R3: --add issues POST with handle + pidChain (no `at` when omitted)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', responders: [{ handle: '@a' }] }));
    await handleRoomVerb('responders', ['--room', 'r', '--add', '@a'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('POST');
    expect(bodyAt(captured)).toMatchObject({ handle: '@a' });
    expect(bodyAt(captured).at).toBeUndefined();
  });
  it('R4: --add with --at sends numeric position', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', responders: [] }));
    await handleRoomVerb('responders', ['--room', 'r', '--add', '@a', '--at', '1'], runtime, { CliInputError });
    expect(bodyAt(captured).at).toBe(1);
  });
  it('R5: --remove issues DELETE with handle + pidChain in JSON body', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', responders: [] }));
    await handleRoomVerb('responders', ['--room', 'r', '--remove', '@a'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(bodyAt(captured)).toMatchObject({ handle: '@a' });
  });
  it('R6: --move requires --to and issues PATCH', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'r', responders: [] }));
    await expect(handleRoomVerb('responders', ['--room', 'r', '--move', '@a'], runtime, { CliInputError }))
      .rejects.toThrow(/--move requires --to/);
    await handleRoomVerb('responders', ['--room', 'r', '--move', '@a', '--to', '2'], runtime, { CliInputError });
    expect(captured.requests[0].init.method).toBe('PATCH');
    expect(bodyAt(captured)).toMatchObject({ handle: '@a', to: 2 });
  });
  it('R7: mutual exclusion — multiple verb flags rejected before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleRoomVerb('responders', ['--room', 'r', '--set', '@a', '--add', '@b'], runtime, { CliInputError })
    ).rejects.toThrow(/mutually exclusive/);
    expect(captured.requests).toHaveLength(0);
  });
});
