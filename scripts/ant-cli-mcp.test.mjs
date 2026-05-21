import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMcpVerb } from './ant-cli-mcp.mjs';
import { makeCliRunner } from './ant-cli.mjs';

class CliInputError extends Error {}

const ADMIN_TOKEN = 'mcp-admin-secret';
const TOKEN_SECRET = 'b'.repeat(64);

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(url, init);
  };
  return {
    runtime: { fetchImpl, serverUrl: 'http://test.local', writeOut: (l) => captured.stdout.push(l), writeErr: (l) => captured.stderr.push(l) },
    captured
  };
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const failure = (status, text) => ({ ok: false, status, json: async () => ({}), text: async () => text });
const sentBody = (captured, n = 0) => JSON.parse(captured.requests[n].init.body);

beforeEach(() => { delete process.env.ANT_ADMIN_TOKEN; });
afterEach(() => { delete process.env.ANT_ADMIN_TOKEN; });

function noOutputSecret(captured, ...secrets) {
  const out = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
  for (const secret of secrets) expect(out.includes(secret)).toBe(false);
}

describe('ant mcp', () => {
  it('M1: grant POSTs body + bearer and prints tokenSecret exactly on create', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grant: { token_id: 'tok_1', handle: '@mcp', label: 'Desk' }, tokenSecret: TOKEN_SECRET }));
    const code = await handleMcpVerb('grant', ['--room', 'r1', '--handle', 'mcp', '--label', 'Desk', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/mcp/grants');
    expect(captured.requests[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect(sentBody(captured)).toMatchObject({ roomId: 'r1', handle: 'mcp', label: 'Desk' });
    expect(captured.stdout.join('\n')).toContain(TOKEN_SECRET);
    noOutputSecret(captured, ADMIN_TOKEN);
  });

  it('M2: grant --json emits raw create payload once', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grant: { token_id: 'tok_1' }, tokenSecret: TOKEN_SECRET }));
    await handleMcpVerb('grant', ['--room', 'r1', '--handle', '@mcp', '--json', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual({ grant: { token_id: 'tok_1' }, tokenSecret: TOKEN_SECRET });
  });

  it('M3: admin token is required before fetch for admin verbs', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleMcpVerb('list', ['--room', 'r1'], runtime, { CliInputError })).rejects.toThrow(/admin token required/);
    expect(captured.requests).toHaveLength(0);
  });

  it('M4: list GETs safe metadata and text output never contains token bytes', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grants: [{ token_id: 'tok_1', handle: '@mcp', label: 'Desk', revoked_at: null, tokenSecret: TOKEN_SECRET }] }));
    await handleMcpVerb('list', ['--room', 'r1', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/mcp/grants?roomId=r1');
    expect(captured.stdout[0]).toBe('tok_1\t@mcp\tDesk\tactive');
    noOutputSecret(captured, TOKEN_SECRET, ADMIN_TOKEN);
  });

  it('M5: list --include-revoked --json passes the query flag', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grants: [] }));
    await handleMcpVerb('list', ['--room', 'r1', '--include-revoked', '--json', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(captured.requests[0].url).toContain('includeRevoked=1');
    expect(JSON.parse(captured.stdout[0])).toEqual({ grants: [] });
  });

  it('M6: revoke POSTs token id and prints no token bytes', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ token_id: 'tok_1', revoked: true }));
    await handleMcpVerb('revoke', ['--token-id', 'tok_1', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/mcp/grants/tok_1/revoke');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(captured.stdout[0]).toBe('Revoked MCP grant tok_1');
    noOutputSecret(captured, TOKEN_SECRET, ADMIN_TOKEN);
  });

  it('M7: hostile error bodies redact admin token', async () => {
    const { runtime, captured } = makeRuntime(() => failure(500, `admin leak ${ADMIN_TOKEN}`));
    const code = await handleMcpVerb('revoke', ['--token-id', 'tok_1', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(code).toBe(1);
    noOutputSecret(captured, ADMIN_TOKEN);
  });

  it('M8: missing required flags fail before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleMcpVerb('grant', ['--room', 'r1', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError })).rejects.toThrow(/--handle/);
    expect(captured.requests).toHaveLength(0);
  });

  it('M9: main runner dispatches the mcp primary verb', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => { calls.push({ url, init }); return okJson({ grants: [] }); },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['mcp', 'list', '--room', 'r1', '--admin-token', ADMIN_TOKEN]);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/mcp/grants?roomId=r1');
  });
});
