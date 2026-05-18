import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../src/routes/api/workspace-file/+server.js';

let tempDir = '';
let originalCwd = '';

function event(path: string | null) {
  const url = new URL('https://ant.test/api/workspace-file');
  if (path !== null) url.searchParams.set('path', path);
  return { url } as any;
}

async function expectHttpError(action: () => unknown | Promise<unknown>, status: number) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

describe.sequential('/api/workspace-file', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'ant-workspace-file-'));
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    mkdirSync(join(tempDir, 'output'), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
    originalCwd = '';
  });

  it('serves allowed workspace files with no-store and content headers', async () => {
    writeFileSync(join(tempDir, 'docs', 'notes.md'), '# Notes\n\nHello ANT.\n', 'utf8');

    const response = await GET(event('docs/notes.md'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Length')).toBe('20');
    expect(await response.text()).toBe('# Notes\n\nHello ANT.\n');
  });

  it('rejects path traversal, disallowed top-level paths, and missing path values', async () => {
    await expectHttpError(() => GET(event('../outside.txt')), 403);
    await expectHttpError(() => GET(event('package.json')), 403);
    await expectHttpError(() => GET(event(null)), 400);
  });

  it('returns 404 for missing allowed files', async () => {
    await expectHttpError(() => GET(event('docs/missing.md')), 404);
  });

  it('rejects allowed files over the route byte limit', async () => {
    writeFileSync(join(tempDir, 'output', 'large.log'), Buffer.alloc(1024 * 1024 + 1));

    await expectHttpError(() => GET(event('output/large.log')), 413);
  });
});
