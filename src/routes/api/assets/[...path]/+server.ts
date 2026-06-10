/**
 * GET /api/assets/[...path]
 *
 * Serves files from the resolved external asset roots
 * (ANT_ASSET_ROOTS env var + ~/.ant/asset-folders.json + the repo's
 * `static/` fallback — see `assetRootsResolved`).
 *
 * Multi-root resolution:
 *   - Loops every root in the resolved list
 *   - For each root, computes the candidate path AND checks file existence
 *     (stat.isFile()) in a single pass
 *   - Returns the FIRST root where the file truly exists — so a relative
 *     path always wins by existence, not by containment. (Critically: this
 *     means a configured `~/ant-assets` folder does NOT shadow images that
 *     live in the `static/` fallback — `static/` is consulted too.)
 *
 * Security:
 *   - Public-read (matches the existing static/ posture)
 *   - Strict path-traversal guard (rejects `..` / `.` segments +
 *     absolute paths at the request level)
 *   - **realpath() check** to defeat symlink escape: after we resolve the
 *     candidate, we `realpath()` it (which follows symlinks) and re-verify
 *     the result is still a child of the resolved root. A symlink inside
 *     an asset folder pointing OUTSIDE the root would otherwise be
 *     followed by readFile and serve arbitrary files unauthenticated.
 *     realpath + recheck is the standard fix; `lstat + reject` is the
 *     alternative but breaks legitimate use of symlinks.
 *   - No upload/write handler exists in this PR; files come in by the
 *     operator dropping them in the folder directly (per JWPK
 *     msg_7nqg8oaufo: user adds files manually).
 *
 * Headers:
 *   - Content-Type: sniffed from extension (small allowlist: image/* + font/*
 *     + a few common types). No magic-byte sniffing — extension is enough
 *     for the served-assets use case.
 *   - Cache-Control: public, max-age=300 (5 min) — short, since the
 *     operator can drop new files at any time. ETag derived from
 *     stat mtime + size for cheap 304s.
 *   - Range: positional read into a Buffer of just the requested range
 *     (no full-file read into memory per range request).
 *   - 404 on no-match, 400 on traversal, 416 on bad range, 413 on too big.
 *
 * JWPK msg_7nqg8oaufo: served images must NOT live in the repo
 * (OSS-leak risk); they live in an external user-configurable folder.
 * This route is the served side of that contract. The realpath check
 * closes the symlink-escape class — the same OSS-leak vector the
 * external-folder policy exists to prevent.
 *
 * Review finding (researchant, 2026-06-10): the original
 * `resolveSafeAssetPath` was *containment-only* — it returned the
 * first root whose containment check passed without checking file
 * existence. Once an operator added a folder, the static/ fallback
 * 404'd because `roots[0]` was always returned. The fix folds the
 * existence check INTO the loop (so we walk every root and return
 * the first one where the file actually lives) AND adds realpath()
 * + root recheck to close the symlink-escape class.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, stat, open } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, extname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assetRootsResolved } from '$lib/server/assetFolderSettingsStore';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB cap per served file
const CACHE_MAX_AGE_SECONDS = 300;

const MIME_BY_EXT: ReadonlyMap<string, string> = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT.get(ext) ?? 'application/octet-stream';
}

function etagFor(mtimeMs: number, size: number): string {
  const hash = createHash('sha256')
    .update(`${mtimeMs}:${size}`)
    .digest('hex')
    .slice(0, 16);
  return `"${hash}"`;
}

/**
 * Find the first root where the requested relative path exists as a file.
 * Returns `{ resolved, stat, root }` on hit, or null on miss.
 *
 * Multi-root walk: the containment check (does the candidate resolve
 * within the root?) AND the existence check (`stat.isFile()`) run
 * together per root. We return the FIRST root that holds the file — so
 * the static/ fallback chain works as advertised, even after the
 * operator configures additional folders above it.
 *
 * Security: after stat, we `realpath()` the candidate and re-verify
 * it's still a child of the root. This closes the symlink-escape class
 * (a symlink inside an asset folder pointing outside the root would
 * otherwise be followed by readFile and serve arbitrary files
 * unauthenticated — exactly the OSS-leak class this PR exists to
 * prevent). realpath + recheck is the standard fix.
 */
async function findAsset(
  requestPath: string,
  roots: string[]
): Promise<{ resolved: string; stat: Stats; root: string } | null> {
  if (isAbsolute(requestPath)) throw error(400, 'Asset path must be relative.');
  for (const seg of requestPath.split('/')) {
    if (seg === '..' || seg === '.') throw error(400, 'Asset path may not contain .. or . segments.');
  }
  const normalisedRequest = normalize(requestPath);
  for (const root of roots) {
    // realpath the root too — on macOS /var/folders/.../T/... is a symlink
    // to /private/var/folders/.../T/...; the symlink path doesn't match the
    // realpath'd candidate, so containment would always fail. realpath both
    // sides for a true comparison.
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;  // root itself is unreachable; skip
    }
    const realRootWithSep = realRoot + sep;
    const candidate = resolve(root, normalisedRequest);
    const realCandidate = resolve(realRoot, normalisedRequest);
    if (!(realCandidate + sep).startsWith(realRootWithSep) && realCandidate !== realRoot) {
      continue;  // candidate resolved outside the root; try the next
    }
    let st: Stats;
    try {
      st = await stat(candidate);
    } catch {
      continue;  // doesn't exist in this root; try the next
    }
    if (!st.isFile()) continue;
    // realpath() defeats symlink escape: if the candidate is a symlink
    // pointing outside the root, realpath() resolves to the target and
    // the startsWith check below fails — the file is rejected, not served.
    let realCandidateResolved: string;
    try {
      realCandidateResolved = await realpath(candidate);
    } catch {
      continue;  // symlink target missing or unreachable; skip
    }
    if (!(realCandidateResolved + sep).startsWith(realRootWithSep) && realCandidateResolved !== realRoot) {
      continue;  // symlink escaped the root; do not serve
    }
    return { resolved: candidate, stat: st, root };
  }
  return null;
}

export const GET: RequestHandler = async ({ params, request, setHeaders }) => {
  const rawPath = params.path ?? '';
  const roots = assetRootsResolved();
  if (roots.length === 0) {
    throw error(404, 'No asset roots configured.');
  }
  const hit = await findAsset(rawPath, roots);
  if (!hit) throw error(404, 'Asset not found in any configured root.');

  if (hit.stat.size > MAX_FILE_BYTES) throw error(413, 'Asset too large.');

  const etag = etagFor(hit.stat.mtimeMs, hit.stat.size);
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
        'Accept-Ranges': 'bytes'
      }
    });
  }

  // Range support (single range only) — positional read, not full-file
  // load, so a partial request doesn't pull the whole 50MiB into memory.
  const rangeHeader = request.headers.get('range');
  let slice: Buffer;
  let contentLength: number;
  let status: 200 | 206 = 200;
  let contentRange: string | null = null;
  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const spec = rangeHeader.slice('bytes='.length).trim();
    const dash = spec.indexOf('-');
    if (dash < 0) throw error(416, 'Invalid Range.');
    const startStr = spec.slice(0, dash);
    const endStr = spec.slice(dash + 1);
    const start = startStr === '' ? Math.max(0, hit.stat.size - Number(endStr)) : Number(startStr);
    const end = endStr === '' ? hit.stat.size - 1 : Number(endStr);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= hit.stat.size || start > end) {
      throw error(416, 'Range not satisfiable.');
    }
    const length = end - start + 1;
    const buf = Buffer.alloc(length);
    const fh = await open(hit.resolved, 'r');
    try {
      await fh.read(buf, 0, length, start);
    } finally {
      await fh.close();
    }
    slice = buf;
    contentLength = length;
    status = 206;
    contentRange = `bytes ${start}-${end}/${hit.stat.size}`;
  } else {
    slice = await readFile(hit.resolved);
    contentLength = hit.stat.size;
  }

  setHeaders({
    'Content-Type': mimeFor(hit.resolved),
    'Content-Length': String(contentLength),
    'Cache-Control': `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
    ETag: etag,
    'Accept-Ranges': 'bytes',
    ...(contentRange !== null && { 'Content-Range': contentRange })
  });
  // Fresh Uint8Array copy: a view over Buffer's ArrayBufferLike isn't a
  // BodyInit under TS 5.7 generic typed arrays; the copy types as
  // Uint8Array<ArrayBuffer>. Bounded by MAX_FILE_BYTES.
  return new Response(new Uint8Array(slice), { status });
};
