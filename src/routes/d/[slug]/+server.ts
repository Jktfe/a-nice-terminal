/**
 * /d/[slug] — open-slide deck root.
 *
 * Slice 1 of the @open-slide/core port (JWPK ask in ANT artefacts room).
 *
 * Each deck is a directory under ~/CascadeProjects/ANT-Open-Slide/<slug>/
 * with a built `dist/` produced by `npm run build` inside the deck.
 * v3's `decks.ts` manifest + audit + watcher are NOT lifted in Slice 1 —
 * this is just the proxy so a built deck can be opened in the browser.
 *
 * The deck's built index.html references its bundle via /assets/...
 * which would 404 against the v4 root. We rewrite those references to
 * /d/<slug>/assets/... so the catch-all sibling route can serve them.
 *
 * Slug safety: any path traversal attempt (.., absolute paths, /) is
 * rejected before touching disk.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DECKS_ROOT = join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');

function assertSafeSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw error(400, 'Invalid deck slug.');
  }
  if (slug === '.' || slug === '..') {
    throw error(400, 'Invalid deck slug.');
  }
}

export const GET: RequestHandler = async ({ params }) => {
  assertSafeSlug(params.slug);
  const indexPath = join(DECKS_ROOT, params.slug, 'dist', 'index.html');
  let raw: string;
  try {
    raw = await readFile(indexPath, 'utf8');
  } catch {
    throw error(
      404,
      `Deck "${params.slug}" has no built dist/ — run \`npm run build\` inside ` +
      `~/CascadeProjects/ANT-Open-Slide/${params.slug}/ first.`
    );
  }

  // Rewrite absolute asset references so they resolve under /d/<slug>/.
  // Covers the standard open-slide build output: `src`, `href`, and
  // `crossorigin src=` style references plus inline url(/assets/...).
  const rewritten = raw
    .replace(/(src|href)="\/assets\//g, `$1="/d/${params.slug}/assets/`)
    .replace(/url\(\/assets\//g, `url(/d/${params.slug}/assets/`);

  return new Response(rewritten, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Decks are mostly static; let the browser cache aggressively but
      // mark it must-revalidate so a rebuild is picked up.
      'cache-control': 'no-cache, must-revalidate'
    }
  });
};
