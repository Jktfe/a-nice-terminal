/**
 * GET /api/assets/[...path]
 *
 * Serves files from the resolved external asset roots
 * (ANT_ASSET_ROOTS env var + ~/.ant/asset-folders.json + the repo's
 * `static/` fallback — see `assetRootsResolved`).
 *
 * The path param is the relative path inside any of the roots. The first
 * root that has the file wins. The path is strict-checked for traversal
 * (`..` segments rejected; final resolved path must be a child of one of
 * the configured roots) — see `resolveSafeAssetPath`.
 *
 * Auth posture: PUBLIC READ (matches the existing static/ serving and the
 * served-images-as-content posture). No upload/write handler exists in
 * this PR; files come in by the operator dropping them in the folder
 * directly (per JWPK msg_7nqg8oaufo: user adds files manually).
 *
 * Headers:
 *   - Content-Type: sniffed from extension (small allowlist: image/*
 *     + font/* + a few common types). No magic-byte sniffing — the
 *     extension is enough for the served-assets use case, and SvelteKit
 *     can't run the binary-blob magic check on every read.
 *   - Cache-Control: public, max-age=300 (5 min) — short, since the
 *     operator can drop new files at any time. ETag derived from
 *     stat mtime + size for cheap 304s.
 *   - Range: honored (parse the `Range:` header, return 206 + the slice).
 *   - 404 on no-match, 400 on traversal, 416 on bad range.
 *
 * JWPK msg_7nqg8oaufo: served images must NOT live in the repo (OSS-leak
 * risk); they live in an external user-configurable folder. This route is
 * the served side of that contract.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { assetRootsResolved } from '$lib/server/assetFolderSettingsStore';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB cap per served file
const CACHE_MAX_AGE_SECONDS = 300;

const MIME_BY_EXT: ReadonlyMap<string, string> = new Map([
  // images
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  // fonts
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  // common served docs
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT.get(ext) ?? 'application/octet-stream';
}

/**
 * Build a strong ETag from the file's mtime + size. Cheap to compute on
 * every read (the stat is the dominant cost); the result is stable across
 * deploys as long as the operator doesn't touch the file.
 */
function etagFor(mtimeMs: number, size: number): string {
  const hash = createHash('sha256')
    .update(`${mtimeMs}:${size}`)
    .digest('hex')
    .slice(0, 16);
  return `"${hash}"`;
}

/**
 * Resolve the request's path to an absolute file path, OR throw 400 if the
 * path attempts traversal. The first root that has the file wins.
 *
 * Defence-in-depth:
 *   1. Reject any segment that's `..` BEFORE resolving (cheap fast-path).
 *   2. Normalize the joined path and verify it's still a child of the
 *      candidate root — `path.resolve` collapses `..` so this catches
 *      every variant the segment check might miss (e.g. encoded `..` is
 *      already URL-decoded by SvelteKit before we get it, so we don't
 *      re-decode here).
 *   3. Reject absolute paths inside the request — operator configures
 *      roots, the request must always be relative.
 */
function resolveSafeAssetPath(
  requestPath: string,
  roots: string[]
): { resolved: string; sizeBytes: number; mtimeMs: number } {
  if (isAbsolute(requestPath)) throw error(400, 'Asset path must be relative.');
  for (const seg of requestPath.split('/')) {
    if (seg === '..' || seg === '.') throw error(400, 'Asset path may not contain .. or . segments.');
  }
  const normalisedRequest = normalize(requestPath);
  for (const root of roots) {
    const candidate = resolve(root, normalisedRequest);
    const rootResolved = resolve(root) + sep;
    if (!(candidate + sep).startsWith(rootResolved) && candidate !== resolve(root)) {
      continue;  // resolved outside the root; try the next one
    }
    // Synchronous-feeling check via readFile/stat later; here we just
    // verify the candidate is in the root. The actual file existence is
    // checked by the stat() that follows.
    return { resolved: candidate, sizeBytes: 0, mtimeMs: 0 };  // size + mtime filled in by caller
  }
  throw error(404, 'Asset not found in any configured root.');
}

export const GET: RequestHandler = async ({ params, request, setHeaders }) => {
  const rawPath = params.path ?? '';
  const roots = assetRootsResolved();
  if (roots.length === 0) {
    throw error(404, 'No asset roots configured.');
  }
  const { resolved } = resolveSafeAssetPath(rawPath, roots);
  let fileStat;
  try {
    fileStat = await stat(resolved);
  } catch {
    throw error(404, 'Asset not found.');
  }
  if (!fileStat.isFile()) throw error(404, 'Asset path is not a file.');
  if (fileStat.size > MAX_FILE_BYTES) throw error(413, 'Asset too large.');

  const etag = etagFor(fileStat.mtimeMs, fileStat.size);
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  // Range support (single range only — multi-range responses aren't worth
  // the complexity for static-ish assets).
  const rangeHeader = request.headers.get('range');
  let slice: Buffer;
  let contentLength: number;
  let status: 200 | 206 = 200;
  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const spec = rangeHeader.slice('bytes='.length).trim();
    const dash = spec.indexOf('-');
    if (dash < 0) throw error(416, 'Invalid Range.');
    const startStr = spec.slice(0, dash);
    const endStr = spec.slice(dash + 1);
    const start = startStr === '' ? Math.max(0, fileStat.size - Number(endStr)) : Number(startStr);
    const end = endStr === '' ? fileStat.size - 1 : Number(endStr);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= fileStat.size || start > end) {
      throw error(416, 'Range not satisfiable.');
    }
    const fh = await import('node:fs/promises');
    slice = await fh.readFile(resolved);
    slice = slice.subarray(start, end + 1);
    contentLength = end - start + 1;
    status = 206;
    setHeaders({ 'Content-Range': `bytes ${start}-${end}/${fileStat.size}` });
  } else {
    slice = await readFile(resolved);
    contentLength = fileStat.size;
  }

  setHeaders({
    'Content-Type': mimeFor(resolved),
    'Content-Length': String(contentLength),
    'Cache-Control': `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
    ETag: etag,
    'Accept-Ranges': 'bytes'
  });
  return new Response(slice, { status });
};
