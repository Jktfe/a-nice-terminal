import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { assessTargetPreflight, buildRsyncArgs, cleanTargetBuild, formatNextSteps, runPreflight } = await import('../../../scripts/run-oss-migration.mjs');

describe('run-oss-migration helpers', () => {
  it('buildRsyncArgs includes preflight excludes + commercial excludes', () => {
    const args = buildRsyncArgs('/src', '/dst');
    expect(args).toContain('-av');
    expect(args).toContain('--delete');
    expect(args).toContain('--exclude=.git');
    expect(args).toContain('--exclude=node_modules/');
    expect(args).toContain('--exclude=src/lib/server/policyStore.ts');
    expect(args).toContain('--exclude=src/routes/api/policies/');
    expect(args[args.length - 2]).toBe('/src/');
    expect(args[args.length - 1]).toBe('/dst/');
  });

  it('cleanTargetBuild removes build artefacts', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ant-migration-clean-'));
    mkdirSync(join(tmp, 'build'), { recursive: true });
    mkdirSync(join(tmp, '.svelte-kit'), { recursive: true });
    writeFileSync(join(tmp, 'build', 'handler.js'), 'x');
    expect(existsSync(join(tmp, 'build'))).toBe(true);
    cleanTargetBuild(tmp);
    expect(existsSync(join(tmp, 'build'))).toBe(false);
    expect(existsSync(join(tmp, '.svelte-kit'))).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runPreflight returns ok for a valid source tree', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ant-migration-preflight-'));
    writeFileSync(join(tmp, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\n');
    writeFileSync(join(tmp, 'README.md'), '# ANT — AGPL-3.0-or-later\n');
    writeFileSync(join(tmp, 'SECURITY.md'), '# Security\n\nhttps://github.com/Jktfe/a-nice-terminal/security/advisories/new\n');
    writeFileSync(join(tmp, 'CONTRIBUTING.md'), '# Contributing\n\nDeveloper Certificate of Origin\nSigned-off-by: Your Name <you@example.com>\n\nContributions use the same license: AGPL-3.0-or-later.\n');
    writeFileSync(join(tmp, 'NOTICE.md'), '# Notice\n\nANT is licensed under AGPL-3.0-or-later.\n');
    writeFileSync(join(tmp, '.env.example'), 'ANT_API_KEY=\n');
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'ant',
      license: 'AGPL-3.0-or-later',
      repository: { url: 'https://github.com/Jktfe/a-nice-terminal.git' },
      bugs: { url: 'https://github.com/Jktfe/a-nice-terminal/issues' }
    }));
    writeFileSync(join(tmp, 'package-lock.json'), JSON.stringify({ packages: { '': { license: 'AGPL-3.0-or-later' } } }));
    writeFileSync(join(tmp, '.gitignore'), [
      '.env',
      '.env.*',
      '*.db',
      '*.db-*',
      '*.sqlite',
      '*.sqlite-*',
      '.mcp.json',
      '.claude/',
      '.claude',
      'static/artefacts/',
      'static/artefacts'
    ].join('\n'));

    const report = await runPreflight(tmp);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runPreflight fails when required files are missing', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ant-migration-preflight-bad-'));
    writeFileSync(join(tmp, 'LICENSE'), 'AGPL\n');
    // Missing README.md, SECURITY.md, etc.
    const report = await runPreflight(tmp);
    expect(report.ok).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('assessTargetPreflight reports dry-run failures without blocking but blocks real runs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ant-migration-target-preflight-'));
    writeFileSync(join(tmp, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\n');

    const dryRunAssessment = assessTargetPreflight(tmp, { dryRun: true });
    expect(dryRunAssessment.report.ok).toBe(false);
    expect(dryRunAssessment.shouldBlock).toBe(false);

    const writeAssessment = assessTargetPreflight(tmp, { dryRun: false });
    expect(writeAssessment.report.ok).toBe(false);
    expect(writeAssessment.shouldBlock).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('formatNextSteps avoids broad staging in shared public targets', () => {
    const steps = formatNextSteps('/tmp/a-nice-terminal');

    expect(steps.join('\n')).not.toContain('git add -A');
    expect(steps).toEqual(expect.arrayContaining([
      'git add <reviewed-files> && git commit -m "chore(oss): sync from antDev"'
    ]));
  });
});
