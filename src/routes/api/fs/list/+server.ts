/**
 * List immediate subdirectories under an absolute filesystem path.
 *
 *   GET /api/fs/list?path=/some/abs/path[&showHidden=true]
 *     → 200 { path, parent, entries: Array<{ name, hidden }> }
 *     → 400 missing/malformed `path` (must be absolute, no trailing
 *           NUL bytes, no relative segments after normalisation)
 *     → 403 OS-level EACCES (the server process can't read the dir)
 *     → 404 ENOENT or ENOTDIR (path missing or not a directory)
 *     → 500 any other readdir failure
 *
 * Files are filtered out — this endpoint backs the FolderNavigator
 * (cd-to-folder UX) and listing files would just be visual noise.
 *
 * Security note: the endpoint trusts OS permissions to gate reads.
 * fresh-ANT is single-user (the launchd user); we deliberately don't
 * try to sandbox to $HOME because cd-ing into /opt/homebrew, /tmp,
 * /Volumes, etc. is a legitimate user flow. If multi-user mode ships,
 * add an allowlist + per-caller pidChain gate here.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

type FsEntry = { name: string; hidden: boolean };

export const GET: RequestHandler = async ({ url }) => {
  const rawPath = url.searchParams.get('path');
  const showHidden = url.searchParams.get('showHidden') === 'true';

  if (!rawPath || rawPath.length === 0) {
    throw error(400, 'path query param is required.');
  }
  if (rawPath.includes('\0')) {
    throw error(400, 'path must not contain NUL bytes.');
  }
  if (!rawPath.startsWith('/')) {
    throw error(400, 'path must be absolute (start with /).');
  }

  // Normalise: collapse "." / ".." / "//" segments. After resolve() the
  // path is guaranteed to be absolute and canonical; this prevents
  // ../../etc/passwd shenanigans showing up as a normalised path the
  // caller didn't ask for.
  const normalised = resolve(rawPath);

  let dirents;
  try {
    dirents = await readdir(normalised, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') throw error(404, 'Path not found.');
    if (code === 'ENOTDIR') throw error(404, 'Path is not a directory.');
    if (code === 'EACCES' || code === 'EPERM') throw error(403, 'Permission denied.');
    throw error(500, `readdir failed (${code ?? 'unknown'}).`);
  }

  const entries: FsEntry[] = dirents
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, hidden: d.name.startsWith('.') }))
    .filter((e) => showHidden || !e.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = normalised === '/' ? null : dirname(normalised);

  return json({ path: normalised, parent, entries });
};
