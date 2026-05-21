import { describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleDeliveryVerb } from './ant-cli-delivery.mjs';

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

describe('ant delivery wrappers (M3.5a)', () => {
  it('D1: verify GETs the delivery route and renders one-line text including delivery_state + reason', async () => {
    const payload = {
      terminal_id: 'term-abcdefgh-x',
      name: 'term-a',
      agent_kind: null,
      delivery_state: 'verified',
      pane_status: 'verified',
      pane_stale_since: null,
      reason: 'Pane verified at ready prompt.',
      updated_at: Math.floor(Date.now() / 1000)
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleDeliveryVerb('verify', ['--terminal', 'term-abcdefgh-x'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals/term-abcdefgh-x/delivery');
    expect(captured.stdout[0]).toContain('verified');
    expect(captured.stdout[0]).toContain('ready prompt');
  });

  it('D2: verify --json passes server payload through unchanged', async () => {
    const payload = { terminal_id: 't1', delivery_state: 'stale', pane_status: 'stale', pane_stale_since: 123, reason: 'Stopped responding at unix 123.', name: 't1', agent_kind: null, updated_at: 1 };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleDeliveryVerb('verify', ['--terminal', 't1', '--json'], runtime, { CliInputError });
    const parsed = JSON.parse(captured.stdout[0]);
    expect(parsed).toEqual(payload);
  });

  it('D3: verify requires --terminal and fails before fetch when missing', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleDeliveryVerb('verify', [], runtime, { CliInputError })).rejects.toThrow('missing required flag --terminal');
    expect(captured.requests).toHaveLength(0);
  });

  it('D4: verify surfaces server 404 as a thrown error with the status code', async () => {
    const notFound = { ok: false, status: 404, json: async () => ({}), text: async () => 'Terminal not found.' };
    const { runtime } = makeRuntime(() => notFound);
    await expect(handleDeliveryVerb('verify', ['--terminal', 'unknown'], runtime, { CliInputError })).rejects.toThrow(/404/);
  });

  it('D5: unknown subverb throws CliInputError; help / no-action prints usage', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleDeliveryVerb('foo', [], runtime, { CliInputError })).rejects.toThrow('unknown delivery verb: foo');
    const helpCode = await handleDeliveryVerb('help', [], runtime, { CliInputError });
    expect(helpCode).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant delivery verify');
    const noActionCode = await handleDeliveryVerb(undefined, [], runtime, { CliInputError });
    expect(noActionCode).toBe(1);
  });

  it('D6: main runner dispatch exposes delivery verb', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ terminal_id: 't1', delivery_state: 'verified', pane_status: 'verified', pane_stale_since: null, reason: 'r', name: 't1', agent_kind: null, updated_at: 1 });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['delivery', 'verify', '--terminal', 't1']);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/terminals/t1/delivery');
  });
});
