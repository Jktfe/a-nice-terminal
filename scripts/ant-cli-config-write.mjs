/**
 * ant-cli-config-write.mjs — atomic writer for ~/.ant/config.json.
 *
 * xenoCC quickpaste 8729 (2026-05-28): every `ant invite redeem` /
 * `ant invite join-url` succeeds server-side but the locally-minted
 * tokenSecret was never persisted, because the CLI had no writer for
 * config.json. Result: routers read stale May-22 tokens → server
 * rejects → pidChain fallback → 401 wedge on Windows where the
 * router subprocess pidChain dies at MSYS2 boundaries.
 *
 * Shape mirrors the dual-shape READ in ant-cli-browser-session.mjs
 * (PR #68 / 6870a08):
 *   tokens: {
 *     <roomId>: {
 *       token:           "<flat-shape, primary lookup>",
 *       server_url:      "<per-room server URL, slice H reader>",
 *       default_handle:  "@xenocc",
 *       byHandle: {
 *         "@xenocc": { token: "<same secret, back-compat>" }
 *       }
 *     }
 *   }
 *
 * We write BOTH shapes so pre-0.1.11 readers (older binaries on other
 * machines that may share a config via Dropbox / Tailscale-mount /
 * etc) keep working. The flat shape is authoritative — PR #68's
 * reader prefers it.
 *
 * Atomic semantics: read existing → mutate → write to .tmp in the
 * same directory → rename. This is the standard tmpfile dance —
 * rename(2) on POSIX and MoveFileExW with MOVEFILE_REPLACE_EXISTING
 * on Windows are atomic, so a crash between write and rename leaves
 * either the OLD config or the NEW config, never a half-written one.
 *
 * Failure semantics: never throws into the caller's stack. The redeem
 * itself succeeded by the time we're called; failing to persist is a
 * warning-level event, not an error. Callers pass an optional
 * runtime.writeErr to surface a one-line note on failure.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CONFIG_RELATIVE_PATH = ['.ant', 'config.json'];

function configFilePath(homeDirOverride) {
  const home = typeof homeDirOverride === 'string' && homeDirOverride.length > 0
    ? homeDirOverride
    : homedir();
  return join(home, ...CONFIG_RELATIVE_PATH);
}

function readExistingConfig(configPath) {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function ensureParentDirExists(configPath) {
  const parent = dirname(configPath);
  if (existsSync(parent)) return;
  mkdirSync(parent, { recursive: true });
}

/**
 * Atomically write `content` to `path` via a sibling .tmp file. The
 * tmp file lives in the SAME directory as the target so the final
 * rename is a same-filesystem rename (atomic on POSIX + Windows).
 */
function writeAtomic(path, content) {
  ensureParentDirExists(path);
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, path);
}

function normaliseHandle(handle) {
  if (typeof handle !== 'string' || handle.length === 0) return null;
  const trimmed = handle.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Update tokens[roomId] in ~/.ant/config.json with a freshly-minted
 * tokenSecret. Preserves unrelated rooms' entries verbatim. Writes
 * BOTH the flat shape (lookupRoomToken's primary path) AND the
 * byHandle shape (backward-compat with pre-PR-68 readers).
 *
 * @param {object} options
 * @param {string} options.roomId        — chat room id (e.g. "0mcytty7ng")
 * @param {string} options.tokenSecret   — fresh secret from invite redeem
 * @param {string=} options.handle       — optional handle for byHandle entry
 *                                          + default_handle
 * @param {string=} options.serverUrl    — optional per-room server URL
 *                                          (slice H reads this)
 * @param {string=} options.homeDir      — test injection point
 *
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function persistRoomTokenToConfig(options) {
  const { roomId, tokenSecret, handle, serverUrl, homeDir } = options;
  if (typeof roomId !== 'string' || roomId.length === 0) {
    return { ok: false, error: 'roomId required' };
  }
  if (typeof tokenSecret !== 'string' || tokenSecret.length === 0) {
    return { ok: false, error: 'tokenSecret required' };
  }
  const configPath = configFilePath(homeDir);
  try {
    const config = readExistingConfig(configPath);
    const tokens = (config.tokens && typeof config.tokens === 'object' && !Array.isArray(config.tokens))
      ? { ...config.tokens }
      : {};
    const existingEntry = (tokens[roomId] && typeof tokens[roomId] === 'object')
      ? tokens[roomId]
      : {};
    const normalisedHandle = normaliseHandle(handle);
    const existingByHandle = (existingEntry.byHandle && typeof existingEntry.byHandle === 'object')
      ? { ...existingEntry.byHandle }
      : {};
    if (normalisedHandle) {
      const handleEntry = (existingByHandle[normalisedHandle]
        && typeof existingByHandle[normalisedHandle] === 'object')
        ? { ...existingByHandle[normalisedHandle], token: tokenSecret }
        : { token: tokenSecret };
      existingByHandle[normalisedHandle] = handleEntry;
    }
    const updatedEntry = {
      ...existingEntry,
      token: tokenSecret
    };
    if (typeof serverUrl === 'string' && serverUrl.length > 0) {
      updatedEntry.server_url = serverUrl;
    }
    if (normalisedHandle) {
      updatedEntry.default_handle = normalisedHandle;
    }
    if (Object.keys(existingByHandle).length > 0) {
      updatedEntry.byHandle = existingByHandle;
    }
    tokens[roomId] = updatedEntry;
    const nextConfig = { ...config, tokens };
    writeAtomic(configPath, JSON.stringify(nextConfig, null, 2));
    return { ok: true, path: configPath };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause)
    };
  }
}

/**
 * For tests + introspection. Returns whatever's at tokens[roomId]
 * verbatim (or null when the file is missing / malformed / has no
 * entry for that room).
 */
export function readRoomTokenEntry(roomId, homeDir) {
  if (typeof roomId !== 'string' || roomId.length === 0) return null;
  const configPath = configFilePath(homeDir);
  if (!existsSync(configPath)) return null;
  const config = readExistingConfig(configPath);
  const entry = config?.tokens?.[roomId];
  return (entry && typeof entry === 'object') ? entry : null;
}

/** Test-only helper exposing the resolved path for assertions. */
export function _configFilePathForTests(homeDir) {
  return configFilePath(homeDir);
}

/** Test-only helper exposing the writer for the small ms-delta probe. */
export function _statConfigForTests(homeDir) {
  const path = configFilePath(homeDir);
  return existsSync(path) ? statSync(path) : null;
}
