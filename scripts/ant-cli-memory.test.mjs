/**
 * ant memory CLI tests — MEMORY-CRUD (2026-05-16).
 *
 * Mocks fetch and captures stdout/stderr so behaviour is verified without
 * hitting a real server. Each test wires the runtime explicitly so the
 * fetch handler can assert on URL + method + body.
 */

import { describe, expect, it } from 'vitest';
import { handleMemoryVerb } from './ant-cli-memory.mjs';

class CliInputError extends Error {}

function makeRuntime(fetchHandler) {
  const captured = { stdout: [], stderr: [] };
  return {
    runtime: {
      fetchImpl: fetchHandler,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('ant memory CLI', () => {
  it('memory get fetches /api/memories/key/<key> and prints a line', async () => {
    const seen = [];
    const { runtime, captured } = makeRuntime(async (url) => {
      seen.push(url);
      return makeJsonResponse({ memory: { key: 'k1', value: 'v1', scope: 'global', scopeTarget: null } });
    });
    const code = await handleMemoryVerb('get', ['k1'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(seen[0]).toBe('http://test.local/api/memories/key/k1');
    expect(captured.stdout[0]).toContain('k1');
    expect(captured.stdout[0]).toContain('v1');
  });

  it('memory get on missing key prints (no memory at ...) and returns 1', async () => {
    const { runtime, captured } = makeRuntime(async () =>
      new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    );
    const code = await handleMemoryVerb('get', ['ghost'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stdout[0]).toContain('no memory at ghost');
  });

  it('memory put POSTs the body and reports Created on 201', async () => {
    let captured;
    const { runtime, captured: streams } = makeRuntime(async (url, init) => {
      captured = { url, init };
      return makeJsonResponse(
        { memory: { key: 'k1', value: 'v1' }, created: true },
        201
      );
    });
    const code = await handleMemoryVerb(
      'put',
      ['k1', '--value', 'v1', '--by', '@a'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.init.method).toBe('POST');
    const body = JSON.parse(captured.init.body);
    expect(body).toMatchObject({ key: 'k1', value: 'v1', byHandle: '@a', scope: 'global' });
    expect(streams.stdout[0]).toMatch(/^Created/);
  });

  it('memory put without --value is rejected with CliInputError', async () => {
    const { runtime } = makeRuntime(async () => makeJsonResponse({}));
    await expect(
      handleMemoryVerb('put', ['k1'], runtime, { CliInputError })
    ).rejects.toThrow(/--value/);
  });

  it('memory list --prefix encodes the prefix in the query', async () => {
    const seen = [];
    const { runtime } = makeRuntime(async (url) => {
      seen.push(url);
      return makeJsonResponse({ memories: [] });
    });
    const code = await handleMemoryVerb(
      'list',
      ['--prefix', 'agents/'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(seen[0]).toBe('http://test.local/api/memories?prefix=agents%2F');
  });

  it('memory list rejects --prefix combined with --terminal', async () => {
    const { runtime } = makeRuntime(async () => makeJsonResponse({}));
    await expect(
      handleMemoryVerb(
        'list',
        ['--prefix', 'x', '--terminal', 'y'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/only one of/);
  });

  it('memory delete sends DELETE and prints Deleted on 204', async () => {
    let seenMethod;
    const { runtime, captured } = makeRuntime(async (_url, init) => {
      seenMethod = init?.method;
      return new Response(null, { status: 204 });
    });
    const code = await handleMemoryVerb(
      'delete',
      ['agents/r/role'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(seenMethod).toBe('DELETE');
    expect(captured.stdout[0]).toMatch(/^Deleted/);
  });

  it('memory delete on missing key prints (no memory at ...) and returns 1', async () => {
    const { runtime, captured } = makeRuntime(async () => new Response(null, { status: 404 }));
    const code = await handleMemoryVerb('delete', ['ghost'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stdout[0]).toContain('no memory at ghost');
  });

  it('memory audit --json emits a JSON payload', async () => {
    const { runtime, captured } = makeRuntime(async () =>
      makeJsonResponse({ audit: [{ atMs: 1234, action: 'put', memoryKey: 'k1', byHandle: '@a' }] })
    );
    await handleMemoryVerb('audit', ['--json'], runtime, { CliInputError });
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload.audit[0].action).toBe('put');
  });

  it('unknown sub-verb is rejected', async () => {
    const { runtime } = makeRuntime(async () => makeJsonResponse({}));
    await expect(
      handleMemoryVerb('frobnicate', [], runtime, { CliInputError })
    ).rejects.toThrow(/unknown memory verb/);
  });

  it('help prints usage', async () => {
    const { runtime, captured } = makeRuntime(async () => makeJsonResponse({}));
    const code = await handleMemoryVerb('help', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout[0]).toMatch(/^ant memory/);
  });
});
