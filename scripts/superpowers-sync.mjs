#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_MANIFEST_PATH = join(REPO_ROOT, 'superpowers/sync-manifest.json');

export function readSyncManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest) {
  if (manifest?.schema !== 1) throw new Error('manifest schema must be 1');
  if (!manifest.source?.repo) throw new Error('manifest source.repo is required');
  if (!manifest.source?.branch) throw new Error('manifest source.branch is required');
  if (!/^[0-9a-f]{40}$/i.test(manifest.source?.pinnedCommit ?? '')) {
    throw new Error('manifest source.pinnedCommit must be a 40-character git SHA');
  }
  if (!manifest.localMirror) throw new Error('manifest localMirror is required');
  if (!Array.isArray(manifest.syncRoots) || manifest.syncRoots.length === 0) {
    throw new Error('manifest syncRoots must be a non-empty array');
  }
  for (const root of manifest.syncRoots) {
    if (!root.name || !root.upstream || !root.local) {
      throw new Error('each sync root needs name, upstream, and local');
    }
  }
}

export function parseLsRemoteHead(stdout) {
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? '';
  const sha = firstLine.split(/\s+/)[0] ?? '';
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

export function compareDirectoryTrees(sourceRoot, targetRoot) {
  if (!existsSync(sourceRoot)) {
    return { sourceMissing: true, missing: [], changed: [], extra: [] };
  }
  const sourceFiles = listRelativeFiles(sourceRoot);
  const targetFiles = existsSync(targetRoot) ? listRelativeFiles(targetRoot) : [];
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const missing = sourceFiles.filter((file) => !targetSet.has(file));
  const extra = targetFiles.filter((file) => !sourceSet.has(file));
  const changed = sourceFiles.filter((file) => {
    if (!targetSet.has(file)) return false;
    return hashFile(join(sourceRoot, file)) !== hashFile(join(targetRoot, file));
  });
  return { sourceMissing: false, missing, changed, extra };
}

export function hasTreeDrift(status) {
  return Boolean(
    status.sourceMissing ||
    status.missing.length > 0 ||
    status.changed.length > 0 ||
    status.extra.length > 0
  );
}

function listRelativeFiles(root) {
  const files = [];
  const visit = (dir, prefix) => {
    const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
    for (const entry of entries) {
      if (entry === '.git') continue;
      const fullPath = join(dir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) visit(fullPath, relPath);
      else if (stat.isFile()) files.push(relPath);
    }
  };
  const stat = statSync(root);
  if (stat.isFile()) return [''];
  visit(root, '');
  return files;
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runGit(args, cwd = REPO_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function remoteHeadFor(manifest) {
  const output = runGit([
    'ls-remote',
    manifest.source.repo,
    `refs/heads/${manifest.source.branch}`
  ]);
  const head = parseLsRemoteHead(output);
  if (!head) throw new Error(`could not resolve ${manifest.source.repo} ${manifest.source.branch}`);
  return head;
}

function checkoutPinnedSource(manifest, tempRoot) {
  const checkoutRoot = join(tempRoot, 'Superpowers');
  runGit([
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--branch',
    manifest.source.branch,
    manifest.source.repo,
    checkoutRoot
  ]);
  const head = runGit(['rev-parse', 'HEAD'], checkoutRoot);
  if (head !== manifest.source.pinnedCommit) {
    runGit(['fetch', '--quiet', '--depth', '1', 'origin', manifest.source.pinnedCommit], checkoutRoot);
    runGit(['checkout', '--quiet', manifest.source.pinnedCommit], checkoutRoot);
  }
  return checkoutRoot;
}

function compareManifestRoots(manifest, repoRoot, checkoutRoot) {
  const mirrorRoot = resolve(repoRoot, manifest.localMirror);
  return manifest.syncRoots.map((root) => {
    const sourceRoot = join(checkoutRoot, root.upstream);
    const targetRoot = join(mirrorRoot, root.local);
    return {
      ...root,
      sourceRoot,
      targetRoot,
      ...compareDirectoryTrees(sourceRoot, targetRoot)
    };
  });
}

function copyRoot(status) {
  if (status.sourceMissing) throw new Error(`upstream root missing: ${status.upstream}`);
  rmSync(status.targetRoot, { recursive: true, force: true });
  mkdirSync(dirname(status.targetRoot), { recursive: true });
  const stat = statSync(status.sourceRoot);
  if (stat.isFile()) {
    cpSync(status.sourceRoot, status.targetRoot);
  } else {
    cpSync(status.sourceRoot, status.targetRoot, { recursive: true });
  }
}

function formatStatus(status, repoRoot) {
  const drift = hasTreeDrift(status) ? 'DRIFT' : 'OK';
  const target = relative(repoRoot, status.targetRoot) || status.targetRoot;
  if (status.sourceMissing) return `[${drift}] ${status.name}: upstream root missing (${status.upstream})`;
  return `[${drift}] ${status.name}: ${status.upstream} -> ${target} ` +
    `missing=${status.missing.length} changed=${status.changed.length} extra=${status.extra.length}`;
}

function parseArgs(args) {
  const flags = { write: false, json: false, offline: false, manifestPath: DEFAULT_MANIFEST_PATH };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') flags.write = true;
    else if (arg === '--dry-run') flags.write = false;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--offline') flags.offline = true;
    else if (arg === '--manifest') {
      const value = args[index + 1];
      if (!value) throw new Error('--manifest needs a path');
      flags.manifestPath = resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  return flags;
}

export function runSuperpowersSync(args = process.argv.slice(2), io = console, repoRoot = REPO_ROOT) {
  const flags = parseArgs(args);
  const manifest = readSyncManifest(flags.manifestPath);
  const remoteHead = flags.offline ? null : remoteHeadFor(manifest);
  const upstreamMoved = Boolean(remoteHead && remoteHead !== manifest.source.pinnedCommit);
  const tempRoot = mkdtempSync(join(tmpdir(), 'ant-superpowers-'));
  try {
    const checkoutRoot = checkoutPinnedSource(manifest, tempRoot);
    let statuses = compareManifestRoots(manifest, repoRoot, checkoutRoot);
    const writeNeeded = statuses.some(hasTreeDrift);
    if (flags.write) {
      for (const status of statuses) {
        if (hasTreeDrift(status)) copyRoot(status);
      }
      statuses = compareManifestRoots(manifest, repoRoot, checkoutRoot);
    }
    const localDrift = statuses.some(hasTreeDrift);
    const payload = {
      repo: manifest.source.repo,
      branch: manifest.source.branch,
      pinnedCommit: manifest.source.pinnedCommit,
      remoteHead,
      upstreamMoved,
      mode: flags.write ? 'write' : 'dry-run',
      localMirror: manifest.localMirror,
      localDrift,
      roots: statuses.map((status) => ({
        name: status.name,
        kind: status.kind,
        upstream: status.upstream,
        local: status.local,
        sourceMissing: status.sourceMissing,
        missing: status.missing.length,
        changed: status.changed.length,
        extra: status.extra.length
      }))
    };
    if (flags.json) {
      io.log(JSON.stringify(payload, null, 2));
    } else {
      io.log(`Superpowers source: ${manifest.source.repo} ${manifest.source.branch}`);
      io.log(`Pinned commit: ${manifest.source.pinnedCommit}`);
      if (remoteHead) io.log(`Remote head:   ${remoteHead}${upstreamMoved ? ' (moved)' : ''}`);
      io.log(`Mode: ${payload.mode}`);
      for (const status of statuses) io.log(formatStatus(status, repoRoot));
      if (flags.write && writeNeeded) io.log(`Wrote mirror: ${manifest.localMirror}`);
    }
    return (!flags.write && (localDrift || upstreamMoved)) ? 1 : 0;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  try {
    process.exitCode = runSuperpowersSync();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
