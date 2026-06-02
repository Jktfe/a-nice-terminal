import { describe, expect, it } from 'vitest';
import { handleBindVerb } from './ant-cli-bind.mjs';

class CliInputError extends Error {}

function okJson(body, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function makeRuntime(responses) {
  const captured = { calls: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.calls.push({ url, init });
    const next = responses.shift();
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://fresh.test',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

describe('ant bind', () => {
  it('resolves a friendly terminal_records name and binds by terminal_id with admin bearer', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({
        terminals: [
          {
            sessionId: 't_agy',
            name: 'agyDocs',
            handle: '@agydocs',
            derivedHandle: '@agydocs',
            alive: true
          }
        ]
      }),
      okJson({ membership_id: 'm1', room_id: 'roomA', handle: '@agydocs', terminal_id: 't_agy' }, 201)
    ]);
    const code = await handleBindVerb('--room', [
      'roomA',
      '--handle', '@agydocs',
      '--terminal', 'agyDocs',
      '--admin-token', 'admin-secret'
    ], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.calls[0].url).toBe('http://fresh.test/api/terminals');
    expect(captured.calls[1].url).toBe('http://fresh.test/api/sessions/add');
    expect(captured.calls[1].init.headers.authorization).toBe('Bearer admin-secret');
    const body = JSON.parse(captured.calls[1].init.body);
    expect(body).toEqual({ room_id: 'roomA', handle: '@agydocs', terminal_id: 't_agy' });
    expect(captured.stdout.join('\n')).toContain('Bound @agydocs -> t_agy in roomA');
  });

  it('accepts a terminal session id directly without fetching /api/terminals', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ membership_id: 'm2', room_id: 'roomA', handle: '@masterclaude', terminal_id: 't_master' }, 201)
    ]);
    const code = await handleBindVerb('--room', [
      'roomA',
      '--handle', '@masterclaude',
      '--terminal-id', 't_master',
      '--admin-token', 'admin-secret'
    ], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.calls).toHaveLength(1);
    const body = JSON.parse(captured.calls[0].init.body);
    expect(body.terminal_id).toBe('t_master');
  });

  it('throws a clear error when the friendly terminal name is not found', async () => {
    const { runtime } = makeRuntime([okJson({ terminals: [] })]);
    await expect(handleBindVerb('--room', [
      'roomA',
      '--handle', '@missing',
      '--terminal', 'No Such Terminal',
      '--admin-token', 'admin-secret'
    ], runtime, { CliInputError })).rejects.toThrow(/No terminal matched/);
  });
});
