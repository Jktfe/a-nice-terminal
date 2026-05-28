/**
 * ant memory CLI tests — MEMORY-CRUD (2026-05-16).
 *
 * Mocks fetch and captures stdout/stderr so behaviour is verified without
 * hitting a real server. Each test wires the runtime explicitly so the
 * fetch handler can assert on URL + method + body.
 */

import { describe, expect, it } from 'vitest';
import { handleMemoryVerb } from './ant-cli-memory.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class CliInputError extends Error {}

function makeRuntime(fetchHandler) {
  const captured = { stdout: [], stderr: [] };
  return {
    runtime: {
      fetchImpl: fetchHandler,
      serverUrl: 'http://test.local',
      config: {},
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
  it('memory vault set/get/clear persists the default memory pack root', async () => {
    const originalHome = process.env.HOME;
    const tmpHome = mkdtempSync(join(tmpdir(), 'ant-memory-home-'));
    process.env.HOME = tmpHome;
    try {
      const { runtime, captured } = makeRuntime(async () => makeJsonResponse({}));

      expect(await handleMemoryVerb('vault', ['set', '--path', '/pack/root'], runtime, { CliInputError })).toBe(0);
      expect(await handleMemoryVerb('vault', ['get'], runtime, { CliInputError })).toBe(0);
      expect(captured.stdout.join('\n')).toContain('/pack/root');
      expect(readFileSync(join(tmpHome, '.ant', 'memory-vault.json'), 'utf-8')).toContain('/pack/root');

      expect(await handleMemoryVerb('vault', ['clear'], runtime, { CliInputError })).toBe(0);
      expect(readFileSync(join(tmpHome, '.ant', 'memory-vault.json'), 'utf-8')).toContain('null');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('memory recall searches a Markdown memory pack by local text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-memory-pack-'));
    writeFileSync(join(dir, 'mem_stage.md'), `---\nmemory_id: mem_stage\nlinked_rooms: []\n---\n# ANT Stage\n\nStage decks and validation overlays.\n`, 'utf-8');
    const { runtime, captured } = makeRuntime(async () => makeJsonResponse({}));

    const code = await handleMemoryVerb('recall', ['--MEM-LOCATION', dir, '--search', 'validation'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.stdout.join('\n')).toContain('mem_stage');
    expect(captured.stdout.join('\n')).toContain('ANT Stage');
  });

  it('memory recall uses runtime.config.memoryPackRoot when --MEM-LOCATION is omitted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-memory-pack-'));
    writeFileSync(join(dir, 'mem_stage.md'), `---\nmemory_id: mem_stage\nlinked_rooms: []\n---\n# ANT Stage\n\nStage decks and validation overlays.\n`, 'utf-8');
    const { runtime, captured } = makeRuntime(async () => makeJsonResponse({}));
    runtime.config = { memoryPackRoot: dir };

    const code = await handleMemoryVerb('recall', ['--search', 'validation'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.stdout.join('\n')).toContain('mem_stage');
  });

  it('memory add attaches an existing Markdown memory to a room by memID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-memory-pack-'));
    const filePath = join(dir, 'mem_core.md');
    writeFileSync(filePath, `---\nmemory_id: mem_core\nlinked_rooms: []\n---\n# Core Memory\n\nBody.\n`, 'utf-8');
    const { runtime, captured } = makeRuntime(async () => makeJsonResponse({}));

    const code = await handleMemoryVerb('add', ['--MEM-LOCATION', dir, '--roomID', 'room-a', '--memID', 'mem_core'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(readFileSync(filePath, 'utf-8')).toContain("linked_rooms: ['room-a']");
    expect(captured.stdout[0]).toContain('Attached mem_core to room-a');
  });

  it('memory add --all-rooms attaches an existing Markdown memory to every server room', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-memory-pack-'));
    const filePath = join(dir, 'mem_core.md');
    writeFileSync(filePath, `---\nmemory_id: mem_core\nlinked_rooms: []\n---\n# Core Memory\n\nBody.\n`, 'utf-8');
    const seen = [];
    const { runtime } = makeRuntime(async (url) => {
      seen.push(url);
      return makeJsonResponse({ chatRooms: [{ id: 'room-a' }, { id: 'room-b' }] });
    });

    const code = await handleMemoryVerb('add', ['--MEM-LOCATION', dir, '--all-rooms', '--memID', 'mem_core'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(seen[0]).toContain('http://test.local/api/chat-rooms?pidChain=');
    expect(readFileSync(filePath, 'utf-8')).toContain("linked_rooms: ['room-a', 'room-b']");
  });

  it('memory remove detaches an existing Markdown memory from a room by memID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-memory-pack-'));
    const filePath = join(dir, 'mem_core.md');
    writeFileSync(filePath, `---\nmemory_id: mem_core\nlinked_rooms: ['room-a', 'room-b']\n---\n# Core Memory\n\nBody.\n`, 'utf-8');
    const { runtime } = makeRuntime(async () => makeJsonResponse({}));

    const code = await handleMemoryVerb('remove', ['--MEM-LOCATION', dir, '--roomID', 'room-a', '--memID', 'mem_core'], runtime, { CliInputError });

    expect(code).toBe(0);
    const updated = readFileSync(filePath, 'utf-8');
    expect(updated).not.toContain('room-a');
    expect(updated).toContain("linked_rooms: ['room-b']");
  });

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
