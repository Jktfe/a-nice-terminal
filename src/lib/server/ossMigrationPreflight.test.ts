import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  buildRsyncExcludeArgs,
  scanOssMigrationPreflight,
  summarizePreflight
} from '../../../scripts/check-oss-migration-preflight.mjs';

function makeRepo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'ant-oss-preflight-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    mkdirSync(fullPath.split('/').slice(0, -1).join('/'), { recursive: true });
    writeFileSync(fullPath, contents);
  }
  return root;
}

const goodPackage = JSON.stringify({
  name: 'ant-vnext',
  license: 'AGPL-3.0-or-later',
  repository: { type: 'git', url: 'https://github.com/Jktfe/a-nice-terminal.git' },
  bugs: { url: 'https://github.com/Jktfe/a-nice-terminal/issues' }
}, null, 2);

const goodFiles = {
  'LICENSE': 'GNU AFFERO GENERAL PUBLIC LICENSE\n',
  'README.md': '# ANT\n\nLicensed under AGPL-3.0-or-later for network source availability.\n',
  'SECURITY.md': '# Security\n\nhttps://github.com/Jktfe/a-nice-terminal/security/advisories/new\n',
  'CONTRIBUTING.md': '# Contributing\n\nDeveloper Certificate of Origin\nSigned-off-by: Your Name <you@example.com>\n\nContributions use the same license: AGPL-3.0-or-later.\n',
  'NOTICE.md': '# Notice\n\nANT is licensed under AGPL-3.0-or-later.\n',
  '.env.example': 'ANT_API_KEY=\n',
  '.gitignore': '.env\n.env.*\n!.env.example\n*.db\n*.sqlite\n.mcp.json\n.claude/\nstatic/artefacts/\n',
  'package.json': goodPackage,
  'bun.lock': '# bun lockfile\n'
};

describe('check-oss-migration-preflight', () => {
  it('passes a repo with AGPL docs, package metadata, and migration-safe ignore rules', () => {
    const root = makeRepo(goodFiles);
    const report = scanOssMigrationPreflight({ root });
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(summarizePreflight(report)).toContain('PASS');
  });

  it('fails when public-release metadata or secret/runtime ignore rules are missing', () => {
    const root = makeRepo({
      ...goodFiles,
      'package.json': JSON.stringify({ name: 'ant-vnext' }),
      '.gitignore': '.env\n'
    });
    const report = scanOssMigrationPreflight({ root });
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      'package.json license must be AGPL-3.0-or-later',
      'package.json repository.url must point at Jktfe/a-nice-terminal',
      '.gitignore must exclude SQLite database files (*.db)',
      '.gitignore must exclude local MCP config (.mcp.json)'
    ]));
  });

  it('fails when release posture files are placeholders without required content', () => {
    const root = makeRepo({
      ...goodFiles,
      'SECURITY.md': '# Security\n',
      'CONTRIBUTING.md': '# Contributing\n',
      'NOTICE.md': '# Notice\n'
    });

    const report = scanOssMigrationPreflight({ root });

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      'NOTICE.md must state the AGPL-3.0-or-later license posture',
      'SECURITY.md must include the private GitHub Security Advisory URL',
      'CONTRIBUTING.md must require DCO sign-off',
      'CONTRIBUTING.md must require same-license contributions'
    ]));
  });

  it('flags top-level dated internal docs in public-target mode', () => {
    const root = makeRepo({
      ...goodFiles,
      'docs/meta-plan-room-state-2026-05-16.md': '# internal\n'
    });
    const report = scanOssMigrationPreflight({ root, publicTarget: true });
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('public target must not expose top-level dated/internal docs')
    ]));
  });

  it('includes dirty git entries when require-clean fails', () => {
    const root = makeRepo(goodFiles);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=ANT Test', '-c', 'user.email=ant@example.test', 'commit', '-m', 'init'], {
      cwd: root,
      stdio: 'ignore'
    });
    writeFileSync(join(root, 'dirty.txt'), 'dirty\n');

    const report = scanOssMigrationPreflight({ root, requireClean: true });

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('?? dirty.txt')
    ]));
  });

  it('renders rsync exclude args for local/runtime state', () => {
    expect(buildRsyncExcludeArgs()).toEqual(expect.arrayContaining([
      "--exclude='.git'",
      "--exclude='.env'",
      "--exclude='*.db'",
      "--exclude='static/artefacts/'"
    ]));
  });
});
