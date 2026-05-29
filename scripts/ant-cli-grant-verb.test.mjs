/**
 * Tests for the Stage A `ant grant` CLI verb (plan milestone
 * p3-stage-a-grant-cli of ant-substrate-v0.2-2026-05-29).
 *
 * Covers: positional parsing, target flag exclusivity, scope flag
 * exclusivity, --revoke path, server-error surfacing, and successful
 * POST/DELETE payload shapes.
 */
import { describe, expect, it } from 'vitest';
import { handleGrantVerb } from './ant-cli-grant-verb.mjs';

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

function okJson(body, status = 201) {
  return { ok: true, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function failure(status, bodyText) {
  return { ok: false, status, json: async () => ({}), text: async () => bodyText };
}

describe('handleGrantVerb', () => {
  it('emits usage + returns 1 when invoked with no positional', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    const exit = await handleGrantVerb(undefined, [], runtime, { CliInputError });
    expect(exit).toBe(1);
    expect(captured.stdout.length).toBeGreaterThan(0);
    expect(captured.requests).toHaveLength(0);
  });

  it('emits usage + returns 0 when invoked with help', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    const exit = await handleGrantVerb('help', [], runtime, { CliInputError });
    expect(exit).toBe(0);
    expect(captured.stdout.length).toBeGreaterThan(0);
  });

  it('POSTs to /api/grants with the canonical body for a room grant', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ grant: { grantId: 'gr_abc123', scope: 'once' } })
    );
    const exit = await handleGrantVerb(
      '@speedyc',
      ['chat.post', '--room', 'orsz2321qb'],
      runtime,
      { CliInputError }
    );
    expect(exit).toBe(0);
    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0].url).toBe('http://test.local/api/grants');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.granteeHandle).toBe('@speedyc');
    expect(body.action).toBe('chat.post');
    expect(body.targetKind).toBe('room');
    expect(body.targetId).toBe('orsz2321qb');
    expect(body.pidChain).toBeInstanceOf(Array);
    // Default scope is omitted from the body (server applies 'once').
    expect(body.scope).toBeUndefined();
    expect(captured.stdout[0]).toContain('Granted @speedyc chat.post --room orsz2321qb');
    expect(captured.stdout[0]).toContain('gr_abc123');
  });

  it('normalises handles missing the leading @', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grant: { grantId: 'gr_x' } }));
    await handleGrantVerb('speedyc', ['chat.post', '--room', 'r1'], runtime, {
      CliInputError
    });
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.granteeHandle).toBe('@speedyc');
  });

  it('threads scope when --once is supplied', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grant: { grantId: 'gr_x' } }));
    await handleGrantVerb(
      '@x',
      ['chat.post', '--room', 'r1', '--once'],
      runtime,
      { CliInputError }
    );
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.scope).toBe('once');
  });

  it('threads scope when --always-for-room is supplied', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grant: { grantId: 'gr_x' } }));
    await handleGrantVerb(
      '@x',
      ['chat.post', '--room', 'r1', '--always-for-room'],
      runtime,
      { CliInputError }
    );
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.scope).toBe('always-for-room');
  });

  it('switches to DELETE + reports the revoke count when --revoke is supplied', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ revokedCount: 2 }, 200));
    const exit = await handleGrantVerb(
      '@x',
      ['chat.post', '--room', 'r1', '--revoke'],
      runtime,
      { CliInputError }
    );
    expect(exit).toBe(0);
    expect(captured.requests[0].init.method).toBe('DELETE');
    expect(captured.stdout[0]).toContain('Revoked 2 grants');
  });

  it('reports "No active grant matched" when DELETE returns count=0', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ revokedCount: 0 }, 200));
    await handleGrantVerb(
      '@x',
      ['chat.post', '--room', 'r1', '--revoke'],
      runtime,
      { CliInputError }
    );
    expect(captured.stdout[0]).toContain('No active grant matched');
  });

  it('rejects when no target flag is supplied', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleGrantVerb('@x', ['chat.post'], runtime, { CliInputError })
    ).rejects.toThrow(/grant requires one of --room/);
  });

  it('rejects when two target flags are supplied', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleGrantVerb(
        '@x',
        ['chat.post', '--room', 'r1', '--plan', 'p1'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/exactly one target flag/);
  });

  it('rejects when two scope flags are supplied', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleGrantVerb(
        '@x',
        ['chat.post', '--room', 'r1', '--once', '--always-for-room'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/at most one scope flag/);
  });

  it('rejects when <action> is missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleGrantVerb('@x', ['--room', 'r1'], runtime, { CliInputError })
    ).rejects.toThrow(/grant requires <handle> <action>/);
  });

  it('surfaces server failures with a stderr line and exit=1', async () => {
    const { runtime, captured } = makeRuntime(() => failure(401, 'Authentication required.'));
    const exit = await handleGrantVerb(
      '@x',
      ['chat.post', '--room', 'r1'],
      runtime,
      { CliInputError }
    );
    expect(exit).toBe(1);
    expect(captured.stderr[0]).toContain('ant grant failed (401)');
    expect(captured.stderr[0]).toContain('Authentication required');
  });
});
