import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
const previousSheetsRoot = process.env.ANT_SHEETS_ROOT;

async function loadSheet(slug: string) {
  vi.resetModules();
  const module = await import('./+page.server');
  return module.load({ params: { slug } } as Parameters<typeof module.load>[0]) as Promise<{
    slug: string;
    header: string[];
    rows: string[][];
    filePath: string;
    modifiedAtMs: number | null;
    rowCount: number;
    colCount: number;
  }>;
}

async function caughtLoad(slug: string): Promise<{ status?: number; message?: string }> {
  try {
    await loadSheet(slug);
    return {};
  } catch (thrownByLoad) {
    const failure = thrownByLoad as { status?: number; body?: { message?: string }; message?: string };
    return {
      status: failure.status,
      message: failure.body?.message ?? failure.message
    };
  }
}

describe('/sheets/:slug page server', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-sheets-route-'));
    process.env.ANT_SHEETS_ROOT = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousSheetsRoot === undefined) delete process.env.ANT_SHEETS_ROOT;
    else process.env.ANT_SHEETS_ROOT = previousSheetsRoot;
    vi.resetModules();
  });

  it('loads a CSV sheet from ANT_SHEETS_ROOT', async () => {
    writeFileSync(join(tmpDir, 'costs.csv'), 'Month,Cost\nJan,120\nFeb,150\n', 'utf8');

    const result = await loadSheet('costs');

    expect(result.slug).toBe('costs');
    expect(result.header).toEqual(['Month', 'Cost']);
    expect(result.rows).toEqual([
      ['Jan', '120'],
      ['Feb', '150']
    ]);
    expect(result.filePath).toBe(join(tmpDir, 'costs.csv'));
    expect(result.rowCount).toBe(2);
    expect(result.colCount).toBe(2);
    expect(typeof result.modifiedAtMs).toBe('number');
  });

  it('projects quoted spreadsheet cells through the route loader', async () => {
    writeFileSync(
      join(tmpDir, 'monthly-costs.csv'),
      [
        'Month,Notes,Cost',
        'Jan,"hosting, storage, and AI",120',
        'Feb,"she said ""ship it""",150',
        'Mar,"line one',
        'line two",180'
      ].join('\r\n'),
      'utf8'
    );

    const result = await loadSheet('monthly-costs');

    expect(result.header).toEqual(['Month', 'Notes', 'Cost']);
    expect(result.rows).toEqual([
      ['Jan', 'hosting, storage, and AI', '120'],
      ['Feb', 'she said "ship it"', '150'],
      ['Mar', 'line one\r\nline two', '180']
    ]);
    expect(result.rowCount).toBe(3);
    expect(result.colCount).toBe(3);
  });

  it('returns an empty projection for an empty CSV file', async () => {
    writeFileSync(join(tmpDir, 'empty.csv'), '', 'utf8');

    const result = await loadSheet('empty');

    expect(result.header).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.colCount).toBe(0);
  });

  it('rejects invalid slugs before reading the filesystem', async () => {
    const failure = await caughtLoad('../secret');

    expect(failure.status).toBe(400);
    expect(failure.message).toContain('Invalid sheet slug');
  });

  it('blocks symlinks that resolve outside ANT_SHEETS_ROOT', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'ant-sheets-outside-'));
    try {
      writeFileSync(join(outsideDir, 'secret.csv'), 'Secret\nnope\n', 'utf8');
      symlinkSync(join(outsideDir, 'secret.csv'), join(tmpDir, 'linked.csv'));

      const failure = await caughtLoad('linked');

      expect(failure.status).toBe(400);
      expect(failure.message).toContain('Path traversal blocked');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns 404 for a valid missing sheet', async () => {
    const failure = await caughtLoad('missing');

    expect(failure.status).toBe(404);
    expect(failure.message).toContain('Sheet "missing" not found');
  });
});
