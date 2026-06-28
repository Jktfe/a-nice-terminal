#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureNativeAbiHealthy } from './lib/native-abi-guard.mjs';

/**
 * @typedef {object} SnapshotOptions
 * @property {string} [repoRoot]
 * @property {string} [buildDir]
 * @property {string} [runtimeDir]
 * @property {string} [snapshotId]
 * @property {number} [keepSnapshots]
 */

const STATIC_STREAM_PATTERN =
  "\tres.writeHead(code, headers);\n\tfs.createReadStream(file, opts).pipe(res);";

const STATIC_STREAM_GUARD = [
  "\tconst stream = fs.createReadStream(file, opts);",
  "\tstream.on('error', (err) => {",
  "\t\tif (err?.code === 'ENOENT') {",
  "\t\t\tif (!res.headersSent) {",
  "\t\t\t\tres.statusCode = 404;",
  "\t\t\t\treturn res.end('Not found');",
  "\t\t\t}",
  "\t\t\treturn res.end();",
  "\t\t}",
  "\t\tif (!res.destroyed) res.destroy(err);",
  "\t});",
  "\tstream.on('open', () => {",
  "\t\tif (!res.headersSent) res.writeHead(code, headers);",
  "\t\tstream.pipe(res);",
  "\t});"
].join('\n');

/** @param {string} path */
function readIfExists(path) {
  return existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
}

/**
 * @param {string} buildDir
 * @param {Date} [now]
 */
export function buildSnapshotId(buildDir, now = new Date()) {
  const hash = createHash('sha256');
  hash.update(readIfExists(join(buildDir, 'index.js')));
  hash.update(readIfExists(join(buildDir, 'handler.js')));
  hash.update(readIfExists(join(buildDir, 'server', 'manifest.js')));
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `snap-${stamp}-${hash.digest('hex').slice(0, 12)}`;
}

/** @param {string} handlerPath */
export function patchAdapterNodeStaticEnoentGuard(handlerPath) {
  if (!existsSync(handlerPath)) return false;
  const source = readFileSync(handlerPath, 'utf8');
  if (source.includes("err?.code === 'ENOENT'")) return false;
  if (!source.includes(STATIC_STREAM_PATTERN)) {
    throw new Error(`adapter-node static stream pattern not found in ${handlerPath}`);
  }
  writeFileSync(handlerPath, source.replace(STATIC_STREAM_PATTERN, STATIC_STREAM_GUARD));
  return true;
}

/**
 * @param {string} currentLink
 * @param {string} snapshotDir
 */
function updateCurrentSymlink(currentLink, snapshotDir) {
  const tmpLink = `${currentLink}.tmp-${process.pid}-${Date.now()}`;
  rmSync(tmpLink, { force: true });
  symlinkSync(snapshotDir, tmpLink, 'dir');
  renameSync(tmpLink, currentLink);
}

/**
 * @param {string} snapshotsDir
 * @param {number} keep
 * @param {string} currentSnapshotDir
 */
function pruneOldSnapshots(snapshotsDir, keep, currentSnapshotDir) {
  if (keep <= 0) return;
  const current = realpathSync(currentSnapshotDir);
  const snapshots = readdirSync(snapshotsDir)
    .filter((name) => name.startsWith('snap-'))
    .map((name) => {
      const path = join(snapshotsDir, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const snapshot of snapshots.slice(keep)) {
    if (realpathSync(snapshot.path) === current) continue;
    rmSync(snapshot.path, { recursive: true, force: true });
  }
}

/**
 * @param {SnapshotOptions} [options]
 */
export function prepareImmutableBuildSnapshot({
  repoRoot = process.cwd(),
  buildDir = join(repoRoot, 'build'),
  runtimeDir = join(repoRoot, '.ant-runtime'),
  snapshotId,
  keepSnapshots = 5
} = {}) {
  const sourceBuild = resolve(buildDir);
  if (!existsSync(join(sourceBuild, 'index.js'))) {
    throw new Error(`Missing build/index.js; run "bun run build" before starting (${sourceBuild})`);
  }

  const snapshotsDir = join(resolve(runtimeDir), 'build-snapshots');
  mkdirSync(snapshotsDir, { recursive: true });

  const id = snapshotId ?? buildSnapshotId(sourceBuild);
  const snapshotDir = join(snapshotsDir, id);
  const tempDir = join(snapshotsDir, `.tmp-${id}-${process.pid}`);

  rmSync(tempDir, { recursive: true, force: true });
  if (!existsSync(snapshotDir)) {
    cpSync(sourceBuild, tempDir, { recursive: true, dereference: false });
    patchAdapterNodeStaticEnoentGuard(join(tempDir, 'handler.js'));
    renameSync(tempDir, snapshotDir);
  } else {
    rmSync(tempDir, { recursive: true, force: true });
    patchAdapterNodeStaticEnoentGuard(join(snapshotDir, 'handler.js'));
  }

  const currentLink = join(resolve(runtimeDir), 'build-current');
  updateCurrentSymlink(currentLink, snapshotDir);
  pruneOldSnapshots(snapshotsDir, keepSnapshots, snapshotDir);

  return {
    snapshotDir,
    currentLink,
    entrypoint: join(snapshotDir, 'index.js')
  };
}

/** @param {SnapshotOptions} [options] */
export async function startFromImmutableBuildSnapshot(options = {}) {
  process.env.HOST ??= '0.0.0.0';
  process.env.PORT ??= '6174';
  const result = prepareImmutableBuildSnapshot(options);
  // Guard the recurring better-sqlite3 ABI footgun BEFORE importing the
  // server: a mismatch makes the server "start" then 500 every request.
  // Probe → rebuild-for-this-Node → refuse to serve if still broken, so
  // launchd surfaces it loudly instead of silently. (Bit JWPK twice.)
  ensureNativeAbiHealthy(options.repoRoot ?? process.cwd());
  const entrypoint = realpathSync(result.entrypoint);
  console.log(`[ant-start] serving immutable build snapshot ${basename(result.snapshotDir)}`);
  await import(pathToFileURL(entrypoint).href);
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  startFromImmutableBuildSnapshot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
