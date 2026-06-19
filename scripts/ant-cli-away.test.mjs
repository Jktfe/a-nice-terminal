import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleAwayVerb } from './ant-cli-away.mjs';

class CliInputError extends Error {}

const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_ADMIN_BEARER = process.env.ANT_ADMIN_BEARER;

beforeEach(() => {
  delete process.env.ANT_ADMIN_TOKEN;
  delete process.env.ANT_ADMIN_BEARER;
});

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (ORIGINAL_ADMIN_BEARER === undefined) delete process.env.ANT_ADMIN_BEARER;
  else process.env.ANT_ADMIN_BEARER = ORIGINAL_ADMIN_BEARER;
});

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

describe('ant away wrappers', () => {
  it('gets one handle away mode with admin bearer', async () => {
    const payload = {
      mode: {
        handle: '@JWPK',
        tier: 'away-phone',
        intensity: 10,
        note: 'urgent only',
        expectedBackMs: 123,
        setBy: '@admin',
        setAtMs: 1
      }
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAwayVerb('get', ['--handle', 'JWPK', '--admin-token', 'secret'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/away-modes/%40JWPK');
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer secret');
    expect(captured.stdout[0]).toContain('@JWPK');
    expect(captured.stdout[0]).toContain('away-phone');
    expect(captured.stdout[0]).toContain('urgent only');
  });

  it('sets away-phone using the short phone alias and sends optional fields', async () => {
    const payload = {
      mode: {
        handle: '@JWPK',
        tier: 'away-phone',
        intensity: 8,
        note: 'bank decisions',
        expectedBackMs: 456,
        setBy: '@admin',
        setAtMs: 1
      }
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAwayVerb(
      'set',
      [
        '--handle', '@JWPK',
        '--tier', 'phone',
        '--intensity', '8',
        '--note', 'bank decisions',
        '--expected-back-ms', '456',
        '--admin-token', 'secret'
      ],
      runtime,
      { CliInputError }
    );

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/away-modes/%40JWPK');
    expect(captured.requests[0].init.method).toBe('PUT');
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer secret');
    expect(JSON.parse(captured.requests[0].init.body)).toEqual({
      tier: 'away-phone',
      intensity: 8,
      note: 'bank decisions',
      expectedBackMs: 456
    });
    expect(captured.stdout[0]).toContain('Away mode set');
  });

  it('clears one handle away mode', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ ok: true }));
    const code = await handleAwayVerb('clear', ['--handle', '@JWPK', '--admin-token', 'secret'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/away-modes/%40JWPK');
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer secret');
    expect(captured.stdout[0]).toBe('Away mode cleared for @JWPK');
  });

  it('lists away modes with tier and limit filters', async () => {
    const payload = {
      modes: [
        { handle: '@a', tier: 'away-office', intensity: 40, note: null, expectedBackMs: null },
        { handle: '@b', tier: 'away-office', intensity: 30, note: 'later', expectedBackMs: null }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAwayVerb('list', ['--tier', 'office', '--limit', '2', '--admin-token', 'secret'], runtime, { CliInputError });

    expect(code).toBe(0);
    const url = new URL(captured.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('http://test.local/api/away-modes');
    expect(url.searchParams.get('tier')).toBe('away-office');
    expect(url.searchParams.get('limit')).toBe('2');
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer secret');
    expect(captured.stdout).toHaveLength(2);
  });

  it('requires an admin token before any fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));

    await expect(
      handleAwayVerb('get', ['--handle', '@JWPK'], runtime, { CliInputError })
    ).rejects.toThrow('admin token required');

    expect(captured.requests).toHaveLength(0);
  });

  it('main runner dispatch exposes the away verb', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ mode: { handle: '@JWPK', tier: 'active', intensity: 50, note: null, expectedBackMs: null } });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['away', 'get', '--handle', '@JWPK', '--admin-token', 'secret']);

    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/away-modes/%40JWPK');
  });
});
