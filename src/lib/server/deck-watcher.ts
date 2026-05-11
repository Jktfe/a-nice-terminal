// B3 of main-app-improvements-2026-05-10 — chokidar-driven file watcher
// that broadcasts deck_file_changed events when files inside a deck
// directory are edited on disk. The Vite dev server that serves the
// deck already handles HMR for code paths it owns; the watcher's
// reason for existing is the edit-from-outside-Vite case (an operator
// or another agent rewrites a slide file, or `.ant-deck.json` is
// rebuilt) where Vite has no signal and the proxy would otherwise
// keep serving the stale render until the operator reloads manually.
//
// Browser-side auto-reload is a separate concern: the deck proxy
// injects a small polling script into Trusted-mode HTML that watches
// /api/decks/<slug> for `updated_at` change. The watcher here is the
// source of those `updated_at` writes via setDeckTouchedAt.

import { existsSync } from 'fs';
import { broadcast } from './ws-broadcast.js';
import { queries } from './db.js';
import type { DeckMeta } from './decks.js';

const DEBOUNCE_MS = 300;

interface DeckWatchEntry {
  slug: string;
  ownerSessionId: string;
  watcher: { close: () => Promise<void> | void };
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const ACTIVE_WATCHERS = new Map<string, DeckWatchEntry>();

function flushDeckChange(slug: string): void {
  const entry = ACTIVE_WATCHERS.get(slug);
  if (!entry) return;
  entry.flushTimer = null;
  // Touch the deck row so polling clients see an updated_at change
  // without waiting for the next manifest write.
  try {
    queries.setDeckTouchedAt?.(slug, Date.now());
  } catch {
    // Best-effort; missing query == still broadcast below.
  }
  broadcast(entry.ownerSessionId, {
    type: 'deck_file_changed',
    sessionId: entry.ownerSessionId,
    slug,
    ts_ms: Date.now(),
  });
}

function scheduleFlush(slug: string): void {
  const entry = ACTIVE_WATCHERS.get(slug);
  if (!entry) return;
  if (entry.flushTimer) clearTimeout(entry.flushTimer);
  entry.flushTimer = setTimeout(() => flushDeckChange(slug), DEBOUNCE_MS);
}

/** Start (or reuse) a chokidar watcher for the deck's directory. Safe
 *  to call on every proxy request — first call creates the watcher,
 *  subsequent calls are no-ops. */
export function ensureDeckWatcher(deck: DeckMeta): void {
  if (ACTIVE_WATCHERS.has(deck.slug)) return;
  if (!deck.deck_dir || !existsSync(deck.deck_dir)) return;

  let chokidar: typeof import('chokidar');
  try {
    chokidar = require('chokidar');
  } catch {
    // chokidar not installed in this environment — skip silently.
    return;
  }

  const watcher = chokidar.watch(deck.deck_dir, {
    ignoreInitial: true,
    ignored: [
      // Ignore deck-internal metadata + heavy build trees + VCS.
      /\.ant-deck(\/|$)/,
      /node_modules(\/|$)/,
      /\.git(\/|$)/,
      /dist(\/|$)/,
      /\.svelte-kit(\/|$)/,
    ],
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    persistent: true,
  });

  const entry: DeckWatchEntry = {
    slug: deck.slug,
    ownerSessionId: deck.owner_session_id,
    watcher,
    flushTimer: null,
  };
  ACTIVE_WATCHERS.set(deck.slug, entry);

  watcher.on('add', () => scheduleFlush(deck.slug));
  watcher.on('change', () => scheduleFlush(deck.slug));
  watcher.on('unlink', () => scheduleFlush(deck.slug));
}

export async function stopDeckWatcher(slug: string): Promise<void> {
  const entry = ACTIVE_WATCHERS.get(slug);
  if (!entry) return;
  if (entry.flushTimer) clearTimeout(entry.flushTimer);
  await entry.watcher.close();
  ACTIVE_WATCHERS.delete(slug);
}

/** Test/debug accessor — returns the set of slugs currently being
 *  watched. Not part of the production API. */
export function _activeWatcherSlugs(): string[] {
  return Array.from(ACTIVE_WATCHERS.keys());
}
