// native-abi-guard — boot-time guard against the recurring better-sqlite3
// ABI footgun (a stray `npm install`/`npm rebuild` under the wrong Node
// recompiles better_sqlite3.node for a NODE_MODULE_VERSION the server's
// Node can't load, so every getIdentityDb() call throws ERR_DLOPEN_FAILED
// → the server "starts" but 500s every request). This makes that failure
// LOUD at boot instead of silent at request time: probe → rebuild → re-probe
// → refuse to serve. Bit JWPK twice (2026-06-14); this closes it.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * @param {unknown} err
 * @returns {{ code: unknown, message: string }}
 */
function normaliseThrownValue(err) {
  const errorLike = /** @type {{ code?: unknown, message?: unknown }} */ (
    err && typeof err === 'object' ? err : {}
  );
  return {
    code: errorLike.code,
    message: typeof errorLike.message === 'string' ? errorLike.message : ''
  };
}

/**
 * @param {string} repoRoot
 * @returns {boolean}
 */
function repoDeclaresBetterSqlite3(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(resolve(repoRoot), 'package.json'), 'utf8'));
    return Boolean(pkg?.dependencies?.['better-sqlite3'] || pkg?.devDependencies?.['better-sqlite3']);
  } catch {
    return false;
  }
}

/**
 * Load better-sqlite3 from the given repo and run a trivial query.
 * Returns 'ok' | 'abi' (NODE_MODULE_VERSION/DLOPEN mismatch) | rethrows
 * anything unexpected (a real bug we must not mask).
 * @param {string} repoRoot
 * @returns {'ok' | 'abi'}
 */
export function probeBetterSqlite3(repoRoot) {
  const modPath = join(resolve(repoRoot), 'node_modules', 'better-sqlite3');
  try {
    const require = createRequire(import.meta.url);
    const Database = require(modPath);
    const db = new Database(':memory:');
    try {
      db.prepare('select 1 as ok').get();
    } finally {
      db.close();
    }
    return 'ok';
  } catch (err) {
    const { code, message } = normaliseThrownValue(err);
    if (code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(message)) {
      return 'abi';
    }
    // Not an ABI problem — surface it rather than rebuild-loop on an
    // unrelated failure (e.g. a genuinely corrupt module).
    throw err;
  }
}

/**
 * Ensure better-sqlite3 is ABI-compatible with the running Node before the
 * server is imported. On mismatch, rebuild once for this Node; if it's still
 * broken, throw so the caller can refuse to serve (launchd KeepAlive then
 * surfaces a crash-loop with a clear reason instead of a silent 500 server).
 * @param {string} repoRoot
 * @param {(msg: string) => void} [log]
 */
export function ensureNativeAbiHealthy(repoRoot, log = console.log) {
  if (!repoDeclaresBetterSqlite3(repoRoot)) return;

  if (probeBetterSqlite3(repoRoot) === 'ok') return;

  log(
    `[ant-start] better-sqlite3 ABI mismatch for Node ${process.version} ` +
      `(MODULE_VERSION ${process.versions.modules}); rebuilding before serving…`
  );
  execFileSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: resolve(repoRoot),
    stdio: 'inherit'
  });

  if (probeBetterSqlite3(repoRoot) !== 'ok') {
    throw new Error(
      `[ant-start] FATAL: better-sqlite3 still ABI-broken after rebuild for Node ` +
        `${process.version}. Refusing to serve a 500-on-every-request server. ` +
        `Rebuild manually under the server's Node and restart.`
    );
  }
  log('[ant-start] better-sqlite3 rebuilt for this Node — ABI healthy, continuing boot.');
}
