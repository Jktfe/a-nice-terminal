import { describe, expect, it } from 'vitest';
import { buildRsyncExcludeArgs, summarizePreflight } from './check-oss-migration-preflight.mjs';

describe('buildRsyncExcludeArgs', () => {
  it('returns array of --exclude strings', () => {
    const args = buildRsyncExcludeArgs();
    expect(args.length).toBeGreaterThan(0);
    expect(args[0]).toMatch(/^--exclude='/);
    expect(args.every((a) => a.startsWith("--exclude='"))).toBe(true);
  });

  it('includes common excludes', () => {
    const args = buildRsyncExcludeArgs();
    expect(args).toContain("--exclude='.git'");
    expect(args).toContain("--exclude='.env'");
    expect(args).toContain("--exclude='node_modules/'");
  });
});

describe('summarizePreflight', () => {
  it('formats pass report', () => {
    const report = {
      ok: true,
      root: '/project',
      publicTarget: false,
      failures: [],
      warnings: [],
      rsyncExcludes: ["--exclude='.git'"]
    };
    const out = summarizePreflight(report);
    expect(out).toContain('PASS OSS migration preflight');
    expect(out).toContain('root: /project');
    expect(out).toContain('private-staging');
    expect(out).not.toContain('Failures:');
  });

  it('formats fail report with failures', () => {
    const report = {
      ok: false,
      root: '/project',
      publicTarget: true,
      failures: ['missing LICENSE'],
      warnings: [],
      rsyncExcludes: ["--exclude='.git'"]
    };
    const out = summarizePreflight(report);
    expect(out).toContain('FAIL OSS migration preflight');
    expect(out).toContain('public-target');
    expect(out).toContain('Failures:');
    expect(out).toContain('- missing LICENSE');
  });

  it('includes warnings when present', () => {
    const report = {
      ok: true,
      root: '/project',
      publicTarget: false,
      failures: [],
      warnings: ['old node_modules'],
      rsyncExcludes: ["--exclude='.git'"]
    };
    const out = summarizePreflight(report);
    expect(out).toContain('Warnings:');
    expect(out).toContain('- old node_modules');
  });

  it('includes rsync excludes block', () => {
    const report = {
      ok: true,
      root: '/project',
      publicTarget: false,
      failures: [],
      warnings: [],
      rsyncExcludes: ["--exclude='a'", "--exclude='b'"]
    };
    const out = summarizePreflight(report);
    expect(out).toContain('rsync excludes:');
    expect(out).toContain("--exclude='a' --exclude='b'");
  });
});
