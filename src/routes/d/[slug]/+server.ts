/**
 * /d/[slug] — external built-deck root.
 *
 * Each deck is a directory under one of the configured deck roots with a
 * built `dist/` produced by the source tool (Animotion, Open-Slide, etc.).
 * v3's `decks.ts` manifest + audit + watcher are NOT lifted in Slice 1 —
 * this is just the proxy so a built deck can be opened in the browser.
 *
 * The deck's built index.html references its bundle via absolute paths
 * such as /assets/... and /_app/.... Those would 404 against the v4 root.
 * We rewrite them to /d/<slug>/... so the catch-all sibling route can
 * serve the built deck bundle.
 *
 * Slug safety: any path traversal attempt (.., absolute paths, /) is
 * rejected before touching disk.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deckRootsResolved } from '$lib/server/deckSettingsStore';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const BUILT_DECK_BROWSER_POLYFILLS = `<script>
if (globalThis.crypto && !globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = function () {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function (c) {
      return (Number(c) ^ Math.random() * 16 >> Number(c) / 4).toString(16);
    });
  };
}
</script>`;

function deckRoots(): string[] {
  // Resolution merges ANT_BUILT_DECKS_ROOTS env var → ~/.ant/deck-settings.json
  // → legacy fallbacks. Centralised in deckSettingsStore so the
  // /api/deck-settings endpoint + the Settings panel share the same
  // resolver — operators can edit roots from the in-app UI without
  // touching their shell rc.
  return deckRootsResolved();
}

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
  let indexPath = '';
  let raw: string;
  for (const root of deckRoots()) {
    indexPath = join(root, params.slug, 'dist', 'index.html');
    try {
      raw = await readFile(indexPath, 'utf8');
      const rewritten = raw
        .replace(/(src|href)="\/assets\//g, `$1="/d/${params.slug}/assets/`)
        .replace(/(src|href)="\/_app\//g, `$1="/d/${params.slug}/_app/`)
        .replace(/import\("\/_app\//g, `import("/d/${params.slug}/_app/`)
        .replace(/url\(\/assets\//g, `url(/d/${params.slug}/assets/`)
        .replace(/url\(\/_app\//g, `url(/d/${params.slug}/_app/`)
        .replace(/base:\s*""/g, `base: "/d/${params.slug}"`);
      const html = rewritten.includes('</head>')
        ? rewritten.replace('</head>', `${BUILT_DECK_BROWSER_POLYFILLS}</head>`)
        : `${BUILT_DECK_BROWSER_POLYFILLS}${rewritten}`;

      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache, must-revalidate'
        }
      });
    } catch {
      /* try next deck root */
    }
  }

  throw error(
    404,
    `Deck "${params.slug}" has no built dist/ under ANT_BUILT_DECKS_ROOTS, ` +
    `~/CascadeProjects/ANT-Decks, or ~/CascadeProjects/ANT-Open-Slide.`
  );
};
