import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTailStartOffset } from './transcriptColdBootOffset';

describe('resolveTailStartOffset — cold-boot EOF seek (v4 incident fix)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cbo-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('cold boot (no cached state) → seeks to EOF, skips backlog', () => {
    const f = join(dir, 'big.jsonl');
    const body = 'x'.repeat(100_000);
    writeFileSync(f, body);
    // No cached entry → must return the full file size (start at EOF).
    expect(resolveTailStartOffset(undefined, f)).toBe(body.length);
  });

  it('cached entry for SAME path → resumes from cached byteOffset', () => {
    const f = join(dir, 's.jsonl');
    writeFileSync(f, 'whatever');
    expect(resolveTailStartOffset({ jsonlPath: f, byteOffset: 42 }, f)).toBe(42);
  });

  it('cached entry for DIFFERENT path → cold-boot EOF of the new file', () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeFileSync(a, 'aaaa');
    writeFileSync(b, 'bbbbbbbb');
    // Cached points at A but resolved file is B → EOF(B).
    expect(resolveTailStartOffset({ jsonlPath: a, byteOffset: 2 }, b)).toBe(8);
  });

  it('returns 0 when file does not exist (cannot stat)', () => {
    expect(resolveTailStartOffset(undefined, join(dir, 'missing.jsonl'))).toBe(0);
  });
});
