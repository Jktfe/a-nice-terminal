/**
 * assetFolderSettingsStore — persistent storage for the user-editable list
 * of external asset folders (ANT_ASSET_ROOTS equivalent, editable from
 * /settings).
 *
 * Clone of `deckSettingsStore.ts` shape (same JSON-on-disk pattern, same
 * read/write companion posture, same env-var + file + legacy merge order).
 * The resolver (see `assetRootsResolved`) merges:
 *   1. ANT_ASSET_ROOTS env var (delimiter-split)            — operator's shell
 *   2. asset-folders.json `assetRoots` array               — /settings writes
 *   3. The repo's `static/` directory                       — fallback last
 *      (so the existing :6174 served files keep working
 *       even before any folder is configured)
 * Deduped while preserving order. Non-existent entries are silently
 * skipped at read time — never throw on a missing folder.
 *
 * Lives in ~/.ant/asset-folders.json alongside the rest of the
 * personal-settings family. Absent file is NOT an error (treated as empty
 * roots from the file layer; the static/ fallback keeps things serving).
 *
 * JWPK msg_7nqg8oaufo: served images must NOT live in the repo (OSS-leak
 * risk); they live in an external user-configurable folder, and a user can
 * add files by hand. The resolver + this store are the durable seam.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, parse as parsePath, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/**
 * Guard which directories may be registered as a public asset root. The
 * asset GET route is unauthenticated, so a sensitive root turns every file
 * beneath it into a public download. Reject: the filesystem root and the
 * home directory itself (too broad), and any path containing a hidden
 * (dot-prefixed) segment — that bars ~/.ssh, ~/.ant, ~/.aws, ~/.config, and
 * any repo's .git. The asset route ALSO blocks dotfile/denylisted segments
 * at serve time; this is the defence-in-depth write-side companion.
 */
export function assertSafeAssetRoot(entry: string): void {
  const abs = resolve(entry);
  if (abs === parsePath(abs).root) {
    throw new Error(`Refusing to register filesystem root "${entry}" as an asset folder.`);
  }
  if (abs === homedir()) {
    throw new Error(`Refusing to register the home directory "${entry}" as an asset folder.`);
  }
  if (abs.split(sep).some((segment) => segment.startsWith('.'))) {
    throw new Error(`Refusing to register a hidden/config directory "${entry}" as an asset folder.`);
  }
}

export type AssetFolderSettings = {
  /**
   * Operator-curated list of absolute paths to external asset folders.
   * Each entry should exist on disk; the resolver gracefully skips
   * non-existent entries. Empty entries (length 0 or non-strings) are
   * dropped at read time. Sensitive roots (filesystem root, home dir,
   * hidden/config dirs) ARE rejected at write time by assertSafeAssetRoot,
   * because the asset GET route serving these is unauthenticated.
   *
   * No path-traversal guard at this layer — that's the asset route's job
   * (src/routes/api/assets/[...path]/+server.ts does the resolve + root-
   * check). This store treats entries as opaque strings the operator types
   * in /settings.
   */
  assetRoots: string[];
};

const EMPTY: AssetFolderSettings = { assetRoots: [] };

function defaultSettingsPath(): string {
  return join(homedir(), '.ant', 'asset-folders.json');
}

function safeReadFile(path: string): AssetFolderSettings {
  if (!existsSync(path)) return { assetRoots: [] };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AssetFolderSettings>;
    if (!parsed || typeof parsed !== 'object') return { assetRoots: [] };
    const roots = Array.isArray(parsed.assetRoots)
      ? parsed.assetRoots.filter((entry): entry is string =>
          typeof entry === 'string' && entry.length > 0
        )
      : [];
    return { assetRoots: roots };
  } catch {
    // Malformed JSON is treated as empty rather than throwing — never
    // strand the operator on a corrupt file. Caller can re-write to fix.
    return { assetRoots: [] };
  }
}

export function readAssetFolderSettings(
  filePath: string = defaultSettingsPath()
): AssetFolderSettings {
  return safeReadFile(filePath);
}

export function writeAssetFolderSettings(
  input: { assetRoots: unknown },
  filePath: string = defaultSettingsPath()
): AssetFolderSettings {
  if (!Array.isArray(input.assetRoots)) {
    throw new Error('assetRoots must be an array of non-empty strings.');
  }
  const normalised = input.assetRoots
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // Reject sensitive roots before persisting (the GET route is public).
  for (const entry of normalised) assertSafeAssetRoot(entry);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next: AssetFolderSettings = { assetRoots: normalised };
  writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

/**
 * The canonical resolver used by /api/assets/[...path]/+server.ts.
 * Merges (in order):
 *   1. ANT_ASSET_ROOTS env var (delimiter-split)
 *   2. asset-folders.json `assetRoots` array
 *   3. The repo's `static/` directory (relative to process CWD)
 *      — fallback LAST so existing :6174 served files keep working
 *        even before any folder is configured
 * Deduped while preserving order. Non-existent entries are silently
 * skipped (no warning, no throw) — keeps an operator with a stale config
 * running, just with fewer roots to resolve against.
 */
export function assetRootsResolved(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  filePath: string = defaultSettingsPath()
): string[] {
  const envRoots = (env.ANT_ASSET_ROOTS ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const fileRoots = readAssetFolderSettings(filePath).assetRoots;
  const staticRoot = join(cwd, 'static');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...envRoots, ...fileRoots, staticRoot]) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (!existsSync(entry)) continue;
    out.push(entry);
  }
  return out;
}
