/**
 * /d/[slug]/[...path] — serves any file from the open-slide deck's
 * built dist/ directory. Pairs with /d/[slug]/+server.ts (which rewrote
 * /assets/... references to /d/<slug>/assets/...).
 *
 * Path safety: rejects path traversal, requires the resolved path stays
 * within the deck's dist/ root. Content-type is inferred from the
 * trailing extension (open-slide produces standard web assets).
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DECKS_ROOT = join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

export const GET: RequestHandler = async ({ params }) => {
  if (!SLUG_PATTERN.test(params.slug)) throw error(400, 'Invalid deck slug.');

  // Resolve under the deck's dist/ root and verify no escape.
  const deckRoot = resolve(DECKS_ROOT, params.slug, 'dist');
  const candidate = resolve(deckRoot, params.path);
  if (!candidate.startsWith(deckRoot + '/') && candidate !== deckRoot) {
    throw error(400, 'Path traversal blocked.');
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(candidate);
  } catch {
    throw error(404, 'Asset not found.');
  }

  const ext = extname(candidate).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  // Use a Blob: BodyInit accepts Blob across both DOM and Node typings,
  // unlike Buffer/Uint8Array which TypeScript's BodyInit union narrows
  // away in this SvelteKit + Node config.
  const body = new Blob([new Uint8Array(bytes)], { type: contentType });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      // Hashed asset filenames let us cache indefinitely. Non-hashed
      // root files (index.html, favicon, etc.) hit the /d/<slug>/
      // route which sends must-revalidate, so this only applies to
      // descendants like /assets/* and /skill-cards/*.
      'cache-control': 'public, max-age=31536000, immutable'
    }
  });
};
