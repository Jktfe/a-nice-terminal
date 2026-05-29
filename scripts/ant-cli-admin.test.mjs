import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAdminVerb } from './ant-cli-admin.mjs';
import { makeCliRunner } from './ant-cli.mjs';

class CliInputError extends Error {}

const ADMIN_TOKEN = 'reclaim-admin-secret';

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(url, init);
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

const okJson = (body) => ({
  ok: true, status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body)
});
const failure = (status, text) => ({
  ok: false, status,
  json: async () => ({}),
  text: async () => text
});

beforeEach(() => {
  delete process.env.ANT_ADMIN_TOKEN;
  // Point at a non-existent secrets file so tests don't pick up the
  // operator's real ~/.ant/secrets.env when running locally.
  process.env.ANT_SECRETS_FILE = '/tmp/ant-cli-admin-test-no-such-file.env';
});
afterEach(() => {
  delete process.env.ANT_ADMIN_TOKEN;
  delete process.env.ANT_SECRETS_FILE;
});

describe('ant admin reclaim', () => {
  it('R1: posts request body + bearer and echoes status on success', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ requestId: 'rcm_abc', status: 'executed', affectedRoomIds: ['room-1', 'room-2'], oldArchived: true })
    );
    const code = await handleAdminVerb(
      'reclaim',
      ['--agent', 'tiger', '--new-runtime', 'term-new', '--old-runtime', 'term-old',
       '--auto-approve', '--admin-token', ADMIN_TOKEN],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0].url).toBe('http://test.local/api/admin/reclaim?action=request');
    expect(captured.requests[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body).toMatchObject({
      agentId: 'tiger',
      newRuntimeId: 'term-new',
      oldRuntimeId: 'term-old',
      requestedByAgentId: 'tiger',
      autoApprove: true
    });
    expect(body.challenge).toMatch(/^cli-/);
    expect(captured.stdout[0]).toContain('rcm_abc');
    expect(captured.stdout[0]).toContain('executed');
    expect(captured.stdout[0]).toContain('2 room(s) re-bound');
  });

  it('R2: --json emits the raw payload', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ requestId: 'rcm_abc', status: 'pending', expiresAtMs: 999 })
    );
    await handleAdminVerb(
      'reclaim',
      ['--agent', 'tiger', '--new-runtime', 'term-new', '--json', '--admin-token', ADMIN_TOKEN],
      runtime,
      { CliInputError }
    );
    expect(JSON.parse(captured.stdout[0])).toEqual({
      requestId: 'rcm_abc',
      status: 'pending',
      expiresAtMs: 999
    });
  });

  it('R3: missing admin token throws with recovery message', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleAdminVerb(
        'reclaim',
        ['--agent', 'tiger', '--new-runtime', 'term-new'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/admin token required.*~\/\.ant\/secrets\.env/);
    expect(captured.requests).toHaveLength(0);
  });

  it('R4: env-supplied token works without --admin-token', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const { runtime, captured } = makeRuntime(() =>
      okJson({ requestId: 'rcm_env', status: 'executed', affectedRoomIds: [], oldArchived: false })
    );
    const code = await handleAdminVerb(
      'reclaim',
      ['--agent', 'tiger', '--new-runtime', 'term-new', '--auto-approve'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.requests[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
  });

  it('R5: server 401 returns non-zero and surfaces the failure', async () => {
    const { runtime, captured } = makeRuntime(() => failure(401, 'admin auth required'));
    const code = await handleAdminVerb(
      'reclaim',
      ['--agent', 'tiger', '--new-runtime', 'term-new', '--admin-token', ADMIN_TOKEN],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('401');
    expect(captured.stderr.join('\n')).not.toContain(ADMIN_TOKEN);
  });

  it('R6: missing --agent fails before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleAdminVerb(
        'reclaim',
        ['--new-runtime', 'term-new', '--admin-token', ADMIN_TOKEN],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--agent/);
    expect(captured.requests).toHaveLength(0);
  });

  it('R7: missing --new-runtime fails before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleAdminVerb(
        'reclaim',
        ['--agent', 'tiger', '--admin-token', ADMIN_TOKEN],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--new-runtime/);
    expect(captured.requests).toHaveLength(0);
  });

  it('R8: --requested-by overrides the default agent-as-requester', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ requestId: 'rcm_x', status: 'pending' })
    );
    await handleAdminVerb(
      'reclaim',
      ['--agent', 'tiger', '--new-runtime', 'n', '--requested-by', 'super-admin',
       '--admin-token', ADMIN_TOKEN],
      runtime,
      { CliInputError }
    );
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.requestedByAgentId).toBe('super-admin');
  });

  it('R9: hostile server error body redacts admin token', async () => {
    const { runtime, captured } = makeRuntime(() =>
      failure(500, `leaked ${ADMIN_TOKEN} in body`)
    );
    const code = await handleAdminVerb(
      'reclaim',
      ['--agent', 'tiger', '--new-runtime', 'n', '--admin-token', ADMIN_TOKEN],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(1);
    const allOutput = captured.stderr.join('\n');
    expect(allOutput).not.toContain(ADMIN_TOKEN);
    expect(allOutput).toContain('REDACTED');
  });

  it('R10: main runner dispatches the admin primary verb to admin reclaim', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ requestId: 'rcm_dispatch', status: 'pending' });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['admin', 'reclaim', '--agent', 'tiger', '--new-runtime', 'n']);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://test.local/api/admin/reclaim?action=request');
  });
});
