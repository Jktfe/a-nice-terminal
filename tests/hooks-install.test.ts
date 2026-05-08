import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installCliHooks } from '../cli/commands/hooks.js';

// Builds a fake repo root with a docs/agent-setup/hooks/<cli>/ tree so
// the installer can copy from a sandbox rather than the live repo. This
// keeps the test independent of which templates currently exist on disk
// and lets us mutate the source between runs to exercise idempotence.
function makeFakeRepo(opts: {
  cli: string;
  fileMap: Record<string, string>;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'ant-hooks-install-repo-'));
  const dir = join(root, 'docs', 'agent-setup', 'hooks', opts.cli);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(opts.fileMap)) {
    writeFileSync(join(dir, name), content);
  }
  return root;
}

describe('ant hooks install <cli>', () => {
  let home: string;
  let repoRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ant-hooks-install-home-'));
    repoRoot = makeFakeRepo({
      cli: 'claude-code',
      fileMap: {
        'template.sh': '#!/bin/bash\necho v1\n',
        'NOTES.md': '# notes\n',
        'bootstrap-prompt.md': 'install me\n',
      },
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('first run reports new + writes files into ~/.claude/hooks/ant-status/', () => {
    const result = installCliHooks({ cli: 'claude-code', repoRoot, home });

    expect(result.dryRun).toBe(false);
    expect(result.targetDir).toBe(join(home, '.claude/hooks/ant-status'));
    expect(result.files.map((f) => f.action).sort()).toEqual(['new', 'new', 'new']);

    const targetTemplate = join(home, '.claude/hooks/ant-status/template.sh');
    expect(readFileSync(targetTemplate, 'utf8')).toBe('#!/bin/bash\necho v1\n');
    expect(statSync(targetTemplate).isFile()).toBe(true);
  });

  it('idempotent re-run reports unchanged for every file', () => {
    installCliHooks({ cli: 'claude-code', repoRoot, home });
    const second = installCliHooks({ cli: 'claude-code', repoRoot, home });

    expect(second.files.every((f) => f.action === 'unchanged')).toBe(true);
  });

  it('reports updated when source content changes', () => {
    installCliHooks({ cli: 'claude-code', repoRoot, home });

    // Bump template.sh in the fake repo
    writeFileSync(
      join(repoRoot, 'docs/agent-setup/hooks/claude-code/template.sh'),
      '#!/bin/bash\necho v2\n',
    );

    const second = installCliHooks({ cli: 'claude-code', repoRoot, home });
    const byName = Object.fromEntries(
      second.files.map((f) => [f.target.split('/').pop()!, f.action]),
    );
    expect(byName['template.sh']).toBe('updated');
    expect(byName['NOTES.md']).toBe('unchanged');
    expect(byName['bootstrap-prompt.md']).toBe('unchanged');

    expect(readFileSync(join(home, '.claude/hooks/ant-status/template.sh'), 'utf8'))
      .toBe('#!/bin/bash\necho v2\n');
  });

  it('--dry-run reports actions without touching disk', () => {
    const result = installCliHooks({ cli: 'claude-code', repoRoot, home, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.files.every((f) => f.action === 'new')).toBe(true);

    // Target dir should NOT exist after a pure dry-run.
    expect(() => statSync(join(home, '.claude/hooks/ant-status'))).toThrow(/ENOENT/);
  });

  it('throws a clear error when source templates are missing', () => {
    expect(() =>
      installCliHooks({ cli: 'codex-cli', repoRoot, home }),
    ).toThrow(/Source templates not found/);
  });

  it('CLI surface preserves the install subcommand and supports dry-run', () => {
    const result = spawnSync(
      'bun',
      ['cli/index.ts', 'hooks', 'install', 'claude-code', '--dry-run'],
      {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Would stage claude-code templates');
    expect(result.stdout).toContain('.claude/hooks/ant-status');
    expect(result.stderr).toBe('');
    expect(() => statSync(join(home, '.claude/hooks/ant-status'))).toThrow(/ENOENT/);
  });
});
