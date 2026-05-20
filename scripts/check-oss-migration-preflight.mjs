#!/usr/bin/env node
/**
 * #32 OSS migration preflight.
 *
 * Read-only scanner for the v4 -> a-nice-terminal repo move. It checks the
 * release posture that must be true before any rsync or public visibility gate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * @typedef {{
 *   root?: string;
 *   publicTarget?: boolean;
 *   requireClean?: boolean;
 * }} ScanOptions
 *
 * @typedef {{
 *   ok: boolean;
 *   root: string;
 *   publicTarget: boolean;
 *   checks: Array<{ name: string; ok: boolean }>;
 *   failures: string[];
 *   warnings: string[];
 *   rsyncExcludes: string[];
 * }} PreflightReport
 *
 * @typedef {{
 *   root: string;
 *   publicTarget: boolean;
 *   json: boolean;
 *   help?: boolean;
 *   requireClean?: boolean;
 * }} CliOptions
 */

const REQUIRED_ROOT_FILES = [
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'NOTICE.md',
  '.env.example',
  'package.json',
  'package-lock.json'
];

const IGNORE_RULES = [
  { label: 'environment files (.env)', candidates: ['.env', '.env.*'] },
  { label: 'SQLite database files (*.db)', candidates: ['*.db', '*.db-*'] },
  { label: 'SQLite database files (*.sqlite)', candidates: ['*.sqlite', '*.sqlite-*'] },
  { label: 'local MCP config (.mcp.json)', candidates: ['.mcp.json'] },
  { label: 'Claude/Codex local state (.claude/)', candidates: ['.claude/', '.claude'] },
  { label: 'runtime artefacts (static/artefacts/)', candidates: ['static/artefacts/', 'static/artefacts'] }
];

const RSYNC_EXCLUDES = [
  '.git',
  '.env',
  '.env.*',
  '.mcp.json',
  '.claude/',
  '.ant-agent-sheet/',
  '.ant-runtime/',
  'node_modules/',
  '.svelte-kit/',
  'build/',
  'dist/',
  '*.db',
  '*.db-*',
  '*.sqlite',
  '*.sqlite-*',
  'fresh-ant.db',
  'fresh-ant.db-*',
  'screenshots/',
  'static/artefacts/',
  'src/lib/server/policyStore.ts',
  'src/lib/server/policyActor.ts',
  'src/routes/api/policies/',
  'src/lib/server/featureGates.ts'
];

const INTERNAL_DOC_RE = /(?:meta-plan|ios-native-research|capability-negotiation|commercial|internal|phase-1|research).*2026-05-.*\.md$/i;

/** @param {string} path */
function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

/** @param {string} root */
function listDocs(root) {
  const docsRoot = join(root, 'docs');
  if (!existsSync(docsRoot)) return [];
  return readdirSync(docsRoot)
    .filter((name) => {
      try { return statSync(join(docsRoot, name)).isFile(); } catch { return false; }
    })
    .map((name) => `docs/${name}`);
}

/** @param {string} root */
function getGitWorktreeStatus(root) {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const entries = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return { ok: entries.length === 0, entries };
  } catch {
    return { ok: false, entries: ['unable to read git status'] };
  }
}

/**
 * @param {string} gitignore
 * @param {string[]} candidates
 */
function hasIgnoreRule(gitignore, candidates) {
  const rules = new Set(gitignore.split(/\r?\n/).map((/** @type {string} */ line) => line.trim()).filter(Boolean));
  return candidates.some((/** @type {string} */ candidate) => rules.has(candidate));
}

export function buildRsyncExcludeArgs() {
  return RSYNC_EXCLUDES.map((rule) => `--exclude='${rule}'`);
}

/**
 * @param {ScanOptions} [options]
 * @returns {PreflightReport}
 */
export function scanOssMigrationPreflight({ root = process.cwd(), publicTarget = false, requireClean = false } = {}) {
  const failures = [];
  const warnings = [];
  const checks = [];

  if (requireClean) {
    const gitStatus = getGitWorktreeStatus(root);
    checks.push({ name: 'git worktree clean', ok: gitStatus.ok });
    if (!gitStatus.ok) {
      const preview = gitStatus.entries.slice(0, 20).join(', ');
      const suffix = gitStatus.entries.length > 20 ? `, ... +${gitStatus.entries.length - 20} more` : '';
      failures.push(`git worktree must be clean when --require-clean is set${preview ? `: ${preview}${suffix}` : ''}`);
    }
  }

  for (const file of REQUIRED_ROOT_FILES) {
    const ok = existsSync(join(root, file));
    checks.push({ name: `required file ${file}`, ok });
    if (!ok) failures.push(`missing required root file: ${file}`);
  }

  const pkg = readJson(join(root, 'package.json'));
  if (!pkg) {
    failures.push('package.json must be readable JSON');
  } else {
    if (pkg.license !== 'AGPL-3.0-or-later') {
      failures.push('package.json license must be AGPL-3.0-or-later');
    }
    if (pkg.repository?.url !== 'https://github.com/Jktfe/a-nice-terminal.git') {
      failures.push('package.json repository.url must point at Jktfe/a-nice-terminal');
    }
    if (pkg.bugs?.url !== 'https://github.com/Jktfe/a-nice-terminal/issues') {
      warnings.push('package.json bugs.url should point at Jktfe/a-nice-terminal/issues');
    }
  }

  const lock = readJson(join(root, 'package-lock.json'));
  if (lock && lock.packages?.['']?.license !== 'AGPL-3.0-or-later') {
    failures.push('package-lock root license must be AGPL-3.0-or-later');
  }

  const license = readText(join(root, 'LICENSE'));
  if (license && !license.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) {
    failures.push('LICENSE must contain the AGPL-3.0 license text');
  }

  const readme = readText(join(root, 'README.md'));
  if (readme && !/AGPL/i.test(readme)) {
    failures.push('README.md must mention AGPL network-source obligations');
  }

  const notice = readText(join(root, 'NOTICE.md'));
  if (notice && !/AGPL-3\.0-or-later|GNU Affero General Public License/i.test(notice)) {
    failures.push('NOTICE.md must state the AGPL-3.0-or-later license posture');
  }

  const security = readText(join(root, 'SECURITY.md'));
  if (security && !security.includes('https://github.com/Jktfe/a-nice-terminal/security/advisories/new')) {
    failures.push('SECURITY.md must include the private GitHub Security Advisory URL');
  }

  const contributing = readText(join(root, 'CONTRIBUTING.md'));
  if (contributing && !/Developer Certificate of Origin|Signed-off-by:/i.test(contributing)) {
    failures.push('CONTRIBUTING.md must require DCO sign-off');
  }
  if (contributing && !/AGPL-3\.0-or-later|same license/i.test(contributing)) {
    failures.push('CONTRIBUTING.md must require same-license contributions');
  }

  const gitignore = readText(join(root, '.gitignore'));
  for (const rule of IGNORE_RULES) {
    if (!hasIgnoreRule(gitignore, rule.candidates)) {
      failures.push(`.gitignore must exclude ${rule.label}`);
    }
  }

  if (publicTarget) {
    const internalDocs = listDocs(root).filter((file) => INTERNAL_DOC_RE.test(file));
    if (internalDocs.length > 0) {
      failures.push(`public target must not expose top-level dated/internal docs: ${internalDocs.join(', ')}`);
    }
  } else {
    const internalDocs = listDocs(root).filter((file) => INTERNAL_DOC_RE.test(file));
    if (internalDocs.length > 0) {
      warnings.push(`private staging has internal docs that must stay excluded from public target: ${internalDocs.length}`);
    }
  }

  return {
    ok: failures.length === 0,
    root,
    publicTarget,
    checks,
    failures,
    warnings,
    rsyncExcludes: buildRsyncExcludeArgs()
  };
}

/** @param {PreflightReport} report */
export function summarizePreflight(report) {
  const lines = [
    `${report.ok ? 'PASS' : 'FAIL'} OSS migration preflight`,
    `root: ${report.root}`,
    `mode: ${report.publicTarget ? 'public-target' : 'private-staging'}`
  ];
  if (report.failures.length) {
    lines.push('', 'Failures:');
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push('', 'rsync excludes:', report.rsyncExcludes.join(' '));
  return lines.join('\n');
}

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
function parseArgs(argv) {
  /** @type {CliOptions} */
  const opts = { root: process.cwd(), publicTarget: false, requireClean: false, json: false };
  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === '--public-target') { opts.publicTarget = true; i += 1; continue; }
    if (arg === '--require-clean') { opts.requireClean = true; i += 1; continue; }
    if (arg === '--json') { opts.json = true; i += 1; continue; }
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--root needs a path');
      opts.root = value;
      i += 2;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log('usage: node scripts/check-oss-migration-preflight.mjs [--root PATH] [--public-target] [--require-clean] [--json]');
      process.exit(0);
    }
    const report = scanOssMigrationPreflight(opts);
    console.log(opts.json ? JSON.stringify(report, null, 2) : summarizePreflight(report));
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
