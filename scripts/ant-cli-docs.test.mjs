// Focused tests for ant-cli-docs.mjs.
//
// We mock fetch (returns a known body) and use a real tmp directory so
// the test asserts mkdir + writeFile work end-to-end. The file path the
// CLI prints is verified against the resolved tmp path.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { handleDocsVerb } from './ant-cli-docs.mjs';

class CliInputError extends Error {}
const ctx = { CliInputError };

function makeRuntime(overrides = {}) {
  const stdout = [];
  const stderr = [];
  return {
    fetchImpl: overrides.fetchImpl ?? (async () => ({ ok: true, status: 200, text: async () => 'mock-body' })),
    writeOut: (line) => stdout.push(line),
    writeErr: (line) => stderr.push(line),
    serverUrl: 'http://127.0.0.1:6174',
    stdout,
    stderr
  };
}

describe('ant docs help', () => {
  it('prints the usage line', async () => {
    const runtime = makeRuntime();
    const code = await handleDocsVerb('help', [], runtime, ctx);
    expect(code).toBe(0);
    expect(runtime.stdout.join('\n')).toContain('docs generate --from-cli');
  });

  it('errors on unknown verb', async () => {
    const runtime = makeRuntime();
    await expect(handleDocsVerb('publish', [], runtime, ctx)).rejects.toBeInstanceOf(CliInputError);
  });

  it('requires --from-cli', async () => {
    const runtime = makeRuntime();
    await expect(handleDocsVerb('generate', [], runtime, ctx)).rejects.toBeInstanceOf(CliInputError);
  });
});

describe('ant docs generate --from-cli', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ant-docs-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('fetches /discover.md and writes the body to disk', async () => {
    let fetchedUrl;
    const runtime = makeRuntime({
      fetchImpl: async (url) => {
        fetchedUrl = url;
        return { ok: true, status: 200, text: async () => '# ant CLI verbs\nbody' };
      }
    });
    const code = await handleDocsVerb('generate', ['--from-cli', '--out-dir', tmpDir], runtime, ctx);
    expect(code).toBe(0);
    expect(fetchedUrl).toBe('http://127.0.0.1:6174/discover.md');
    const expectedPath = resolve(tmpDir, 'cli-discovery.md');
    expect(runtime.stdout).toContain(expectedPath);
    const written = await readFile(expectedPath, 'utf8');
    expect(written).toBe('# ant CLI verbs\nbody');
  });

  it('honours --filename override', async () => {
    const runtime = makeRuntime({
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'custom-body' })
    });
    const code = await handleDocsVerb('generate', ['--from-cli', '--out-dir', tmpDir, '--filename', 'verbs.md'], runtime, ctx);
    expect(code).toBe(0);
    expect(runtime.stdout[0]).toBe(resolve(tmpDir, 'verbs.md'));
    const written = await readFile(resolve(tmpDir, 'verbs.md'), 'utf8');
    expect(written).toBe('custom-body');
  });

  it('returns 1 + writes stderr on non-OK fetch', async () => {
    const runtime = makeRuntime({
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'oops' })
    });
    const code = await handleDocsVerb('generate', ['--from-cli', '--out-dir', tmpDir], runtime, ctx);
    expect(code).toBe(1);
    expect(runtime.stderr.join('\n')).toContain('docs fetch failed (500)');
  });

  it('rejects --flag without a value', async () => {
    const runtime = makeRuntime();
    await expect(handleDocsVerb('generate', ['--from-cli', '--out-dir'], runtime, ctx)).rejects.toBeInstanceOf(CliInputError);
  });

  it('rejects --filename with a path separator', async () => {
    const runtime = makeRuntime();
    await expect(
      handleDocsVerb('generate', ['--from-cli', '--out-dir', tmpDir, '--filename', '../escape.md'], runtime, ctx)
    ).rejects.toBeInstanceOf(CliInputError);
    await expect(
      handleDocsVerb('generate', ['--from-cli', '--out-dir', tmpDir, '--filename', 'sub/inside.md'], runtime, ctx)
    ).rejects.toBeInstanceOf(CliInputError);
  });

  it('rejects --filename ".." literally', async () => {
    const runtime = makeRuntime();
    await expect(
      handleDocsVerb('generate', ['--from-cli', '--out-dir', tmpDir, '--filename', '..'], runtime, ctx)
    ).rejects.toBeInstanceOf(CliInputError);
  });
});
