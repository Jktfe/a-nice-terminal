import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRsyncExcludeArgs } from './check-oss-migration-preflight.mjs';
import { runTargetPreflight } from './run-oss-migration.mjs';

function writeValidMigrationRoot(root) {
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\n');
  writeFileSync(join(root, 'README.md'), 'ANT is AGPL licensed.\n');
  writeFileSync(join(root, 'SECURITY.md'), 'Security policy.\n\nhttps://github.com/Jktfe/a-nice-terminal/security/advisories/new\n');
  writeFileSync(join(root, 'CONTRIBUTING.md'), 'Contributing guide.\n\nDeveloper Certificate of Origin\nSigned-off-by: Your Name <you@example.com>\n\nContributions use the same license: AGPL-3.0-or-later.\n');
  writeFileSync(join(root, 'NOTICE.md'), 'Notice.\n\nANT is licensed under AGPL-3.0-or-later.\n');
  writeFileSync(join(root, '.env.example'), 'ANT_API_KEY=change-me\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    license: 'AGPL-3.0-or-later',
    repository: { url: 'https://github.com/Jktfe/a-nice-terminal.git' },
    bugs: { url: 'https://github.com/Jktfe/a-nice-terminal/issues' }
  }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    packages: { '': { license: 'AGPL-3.0-or-later' } }
  }));
  writeFileSync(join(root, '.gitignore'), [
    '.env',
    '.env.*',
    '*.db',
    '*.db-*',
    '*.sqlite',
    '*.sqlite-*',
    '.mcp.json',
    '.claude/',
    'static/artefacts/'
  ].join('\n'));
}

describe('run-oss-migration', () => {
  it('dry-run uses the shared OSS scanner exclude set, including premium policy surfaces', () => {
    expect(buildRsyncExcludeArgs()).toEqual(
      expect.arrayContaining([
        "--exclude='src/lib/server/policyStore.ts'",
        "--exclude='src/lib/server/policyActor.ts'",
        "--exclude='src/routes/api/policies/'",
        "--exclude='src/lib/server/featureGates.ts'"
      ])
    );

    const target = mkdtempSync(join(tmpdir(), 'ant-oss-migration-target-'));
    try {
      execFileSync('git', ['init'], { cwd: target, stdio: 'ignore' });

      const output = execFileSync(
        process.execPath,
        [resolve('scripts/run-oss-migration.mjs'), `--target=${target}`, '--dry-run'],
        { cwd: resolve('.'), encoding: 'utf8' }
      );

      for (const exclude of buildRsyncExcludeArgs()) {
        expect(output).toContain(exclude);
      }
      expect(output).toContain('[dry-run]');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('target preflight fails dirty public targets before write execution', () => {
    const target = mkdtempSync(join(tmpdir(), 'ant-oss-migration-target-'));
    try {
      writeValidMigrationRoot(target);
      execFileSync('git', ['init'], { cwd: target, stdio: 'ignore' });
      execFileSync('git', ['add', '.'], { cwd: target, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=ANT Test', '-c', 'user.email=ant@example.test', 'commit', '-m', 'init'], {
        cwd: target,
        stdio: 'ignore'
      });
      writeFileSync(join(target, 'README.md'), 'ANT is AGPL licensed.\nDirty edit.\n');

      const report = runTargetPreflight(target);

      expect(report.ok).toBe(false);
      expect(report.failures.some((failure) =>
        failure.includes('git worktree must be clean when --require-clean is set')
      )).toBe(true);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
