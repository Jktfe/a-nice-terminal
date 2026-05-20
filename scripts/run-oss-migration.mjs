#!/usr/bin/env node
/**
 * run-oss-migration.mjs — #32 v4 → a-nice-terminal repo move runner.
 *
 * Usage:
 *   node scripts/run-oss-migration.mjs --target=../a-nice-terminal [--dry-run]
 *   (--target accepts any absolute or relative path; sibling-directory layout is the convention.)
 *
 * Steps:
 *   1. Run preflight scanner on source (antDev).
 *   2. If preflight passes, rsync with OSS-safe excludes.
 *   3. Clean build artefacts in target.
 *   4. Print summary for human review.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRsyncExcludeArgs, scanOssMigrationPreflight } from './check-oss-migration-preflight.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_ROOT = resolve(__dirname, '..');

/** @returns {never} */
function printUsage() {
  console.log('Usage: node scripts/run-oss-migration.mjs --target=/path/to/a-nice-terminal [--dry-run]');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const targetArg = args.find((arg) => arg.startsWith('--target='));
  const dryRun = args.includes('--dry-run');
  if (!targetArg) printUsage();
  const target = targetArg.slice(9);
  if (!target) printUsage();
  return { target: resolve(target), dryRun };
}

/** @param {string} sourceRoot */
export async function runPreflight(sourceRoot) {
  return scanOssMigrationPreflight({ root: sourceRoot });
}

/** @param {string} targetRoot */
export function runTargetPreflight(targetRoot) {
  return scanOssMigrationPreflight({
    root: targetRoot,
    publicTarget: true,
    requireClean: true
  });
}

/**
 * @param {string} targetRoot
 * @param {{ dryRun?: boolean }} [options]
 */
export function assessTargetPreflight(targetRoot, { dryRun = false } = {}) {
  const report = runTargetPreflight(targetRoot);
  return {
    report,
    shouldBlock: !dryRun && !report.ok
  };
}

/**
 * @param {string} source
 * @param {string} target
 */
export function buildRsyncArgs(source, target) {
  const excludes = buildRsyncExcludeArgs().map((arg) => {
    const match = /^--exclude='(.+)'$/.exec(arg);
    if (!match) throw new Error(`Unsupported rsync exclude arg: ${arg}`);
    return `--exclude=${match[1]}`;
  });
  return ['-av', '--delete', ...excludes, `${source}/`, `${target}/`];
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} source
 * @param {string} target
 */
export function formatRsyncCommand(source, target) {
  return [
    'rsync',
    '-av',
    '--delete',
    ...buildRsyncExcludeArgs(),
    shellQuote(`${source}/`),
    shellQuote(`${target}/`)
  ].join(' ');
}

/** @param {string} target */
export function cleanTargetBuild(target) {
  for (const dir of ['build', 'dist', '.svelte-kit', 'node_modules']) {
    const p = join(target, dir);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      console.log(`  Cleaned ${p}`);
    }
  }
}

/** @param {string} target */
export function formatNextSteps(target) {
  return [
    `cd ${target}`,
    'git diff --stat   # review the delta',
    'git add <reviewed-files> && git commit -m "chore(oss): sync from antDev"',
    'Run tests in target: npx vitest run',
    'Push to a-nice-terminal public repo'
  ];
}

/** @param {string} root */
function gitShortHead(root) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '(no commits)';
  }
}

async function main() {
  const { target, dryRun } = parseArgs();
  console.log(`OSS migration runner\n  Source : ${SOURCE_ROOT}\n  Target : ${target}\n  Dry run: ${dryRun}\n`);

  if (!existsSync(target)) {
    console.error(`Target directory does not exist: ${target}`);
    process.exit(1);
  }

  console.log('Step 1/5 — preflight scan on source...');
  const report = await runPreflight(SOURCE_ROOT);
  if (!report.ok) {
    console.error('Preflight FAILED:');
    for (const failure of report.failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log('  Preflight PASS');
  for (const warning of report.warnings) console.log(`  ⚠ ${warning}`);

  console.log('\nStep 2/5 — target write-safety preflight...');
  const targetAssessment = assessTargetPreflight(target, { dryRun });
  if (!targetAssessment.report.ok) {
    const prefix = dryRun ? '  [dry-run] target preflight would fail:' : 'Target preflight FAILED:';
    console.error(prefix);
    for (const failure of targetAssessment.report.failures) console.error(`  ✗ ${failure}`);
    if (targetAssessment.shouldBlock) process.exit(1);
  } else {
    console.log('  Target preflight PASS');
  }

  console.log('\nStep 3/5 — rsync with OSS excludes...');
  const rsyncArgs = buildRsyncArgs(SOURCE_ROOT, target);
  console.log(`  ${dryRun ? '[dry-run]' : ''} ${formatRsyncCommand(SOURCE_ROOT, target)}`);
  if (!dryRun) {
    execFileSync('rsync', rsyncArgs, { stdio: 'inherit' });
  }

  console.log('\nStep 4/5 — clean target build artefacts...');
  if (!dryRun) cleanTargetBuild(target);
  else console.log('  [dry-run] skipped');

  console.log('\nStep 5/5 — summary');
  console.log(`  Source HEAD: ${gitShortHead(SOURCE_ROOT)}`);
  console.log(`  Target HEAD: ${gitShortHead(target)}`);
  console.log('\nNext steps:');
  for (const [index, step] of formatNextSteps(target).entries()) {
    console.log(`  ${index + 1}. ${step}`);
  }
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
