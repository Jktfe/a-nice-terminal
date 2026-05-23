#!/usr/bin/env node
/**
 * sync-contracts — split contracts/*.md from JWPK's Obsidian vault into
 * the OSS public repo OR the premium app repo, based on frontmatter.
 *
 * Per `contracts-distribution-v1.md` (JWPK-ratified 2026-05-23):
 *
 *   ObsidiANT/contracts/<id>.md  ← JWPK source-of-truth (private vault)
 *      ↓
 *      visibility: oss      → <repo-root>/docs/contracts/<id>.md  (public)
 *      visibility: premium  → <antchat-root>/Resources/contracts/<id>.md
 *      visibility: private  → not copied; JWPK's private notes only
 *      (no visibility)      → ERROR — fail-closed
 *
 * Designed to be re-run safely (idempotent). Removes stale files from
 * destination dirs if they no longer match the visibility classification.
 *
 * Usage:
 *   node scripts/sync-contracts.mjs                  # run sync
 *   node scripts/sync-contracts.mjs --dry            # show what would change
 *   node scripts/sync-contracts.mjs --vault PATH     # override vault path
 *   node scripts/sync-contracts.mjs --antchat PATH   # override antchat repo path
 *
 * Per guardrail #1 (no dump affordance): this script writes; it does NOT
 * read or print premium content to stdout, ever. The dry-run shows only
 * destinations + visibility, not file bodies.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_VAULT = join(homedir(), 'CascadeProjects', 'ObsidiANT');
const DEFAULT_ANTCHAT = join(homedir(), 'CascadeProjects', 'antchat');
const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

function parseArgs(argv) {
  const args = { dry: false, vault: DEFAULT_VAULT, antchat: DEFAULT_ANTCHAT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--vault') args.vault = resolve(argv[++i]);
    else if (a === '--antchat') args.antchat = resolve(argv[++i]);
  }
  return args;
}

function readFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function listContractFiles(vaultContractsDir) {
  if (!existsSync(vaultContractsDir)) return [];
  return readdirSync(vaultContractsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(vaultContractsDir, f));
}

function classify(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const fm = readFrontmatter(text);
  const visibility = fm.visibility;
  if (visibility === 'oss' || visibility === 'premium' || visibility === 'private') {
    return { visibility, text };
  }
  return { visibility: null, text };
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function writeIfChanged(destPath, content, dry) {
  if (existsSync(destPath)) {
    const existing = readFileSync(destPath, 'utf8');
    if (existing === content) return { changed: false };
  }
  if (dry) return { changed: true, dry: true };
  ensureDir(resolve(destPath, '..'));
  writeFileSync(destPath, content);
  return { changed: true };
}

function deleteStale(destDir, expectedNames, dry) {
  if (!existsSync(destDir)) return [];
  const stale = readdirSync(destDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !expectedNames.has(f));
  if (dry) return stale;
  for (const name of stale) {
    unlinkSync(join(destDir, name));
  }
  return stale;
}

function main() {
  const args = parseArgs(process.argv);
  const vaultContractsDir = join(args.vault, 'contracts');
  const ossDestDir = join(REPO_ROOT, 'docs', 'contracts');
  const premiumDestDir = join(args.antchat, 'Resources', 'contracts');

  console.log(`source:   ${vaultContractsDir}`);
  console.log(`oss →     ${ossDestDir}`);
  console.log(`premium → ${premiumDestDir}`);
  if (args.dry) console.log('(DRY RUN — no files written)');
  console.log('');

  const files = listContractFiles(vaultContractsDir);
  if (files.length === 0) {
    console.error(`No contracts found at ${vaultContractsDir}`);
    process.exit(1);
  }

  const ossNames = new Set();
  const premiumNames = new Set();
  const skipped = [];
  const errors = [];

  for (const filePath of files) {
    const filename = filePath.split('/').pop();
    const { visibility, text } = classify(filePath);
    if (visibility === null) {
      errors.push(filename);
      console.log(`  ✗ ${filename}: NO visibility frontmatter (fail-closed; not synced)`);
      continue;
    }
    if (visibility === 'private') {
      skipped.push(filename);
      console.log(`  · ${filename}: private (skipped)`);
      continue;
    }
    if (visibility === 'oss') {
      const destPath = join(ossDestDir, filename);
      const res = writeIfChanged(destPath, text, args.dry);
      ossNames.add(filename);
      const tag = res.changed ? (res.dry ? 'WOULD WRITE' : 'WROTE') : 'unchanged';
      console.log(`  → oss     ${tag}  ${filename}`);
    } else if (visibility === 'premium') {
      const destPath = join(premiumDestDir, filename);
      const res = writeIfChanged(destPath, text, args.dry);
      premiumNames.add(filename);
      const tag = res.changed ? (res.dry ? 'WOULD WRITE' : 'WROTE') : 'unchanged';
      console.log(`  → premium ${tag}  ${filename}`);
    }
  }

  const ossStale = deleteStale(ossDestDir, ossNames, args.dry);
  const premiumStale = deleteStale(premiumDestDir, premiumNames, args.dry);
  for (const name of ossStale) {
    console.log(`  ← oss     ${args.dry ? 'WOULD DELETE' : 'DELETED'}  ${name} (no longer oss)`);
  }
  for (const name of premiumStale) {
    console.log(`  ← premium ${args.dry ? 'WOULD DELETE' : 'DELETED'}  ${name} (no longer premium)`);
  }

  console.log('');
  console.log(
    `summary: oss=${ossNames.size} premium=${premiumNames.size} private=${skipped.length} ` +
      `oss-stale=${ossStale.length} premium-stale=${premiumStale.length} errors=${errors.length}`
  );

  if (errors.length > 0) {
    console.error('');
    console.error('FAIL-CLOSED: contracts missing visibility frontmatter — NOT synced:');
    for (const f of errors) console.error(`  - ${f}`);
    console.error('');
    console.error('Add `visibility: oss | premium | private` to frontmatter, then re-run.');
    process.exit(2);
  }
}

main();
