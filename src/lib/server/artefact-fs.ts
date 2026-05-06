// Path-safety helpers shared between all on-disk artefact types (decks, sheets,
// docs). These never mutate state — they exist only to validate slugs and
// resolve paths inside a chosen artefact root. Each artefact module supplies
// its own root via openSlideRoot()-style env-driven helpers and uses these to
// ensure no caller-supplied path can escape it or follow a symlink out.
//
// Names retain the `Deck` lineage from when this lived in decks.ts; they are
// generic in behaviour and Wave 2 (sheets, docs) re-uses them as-is. If we
// later want a less-deck-flavoured surface, alias-export new names here rather
// than renaming the originals — both decks.ts and the v0.1.0 swarm plan refer
// to these symbols by name.

import { existsSync, lstatSync } from 'fs';
import { join, relative } from 'path';

// Directory names we never edit through the artefact API regardless of root.
// `.svelte-kit` and `dist` are build outputs; `.git` and `node_modules` are
// VCS / dependency state. Adding to this set rejects future edits in the named
// segment without further code changes.
export const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules', '.svelte-kit', 'dist']);

// Hidden files that are still permitted to be served read/write — we hide
// dotfiles by default to keep accidental secrets out, and add specific safe
// ones here. Used by listDeckFiles and the equivalent listing helpers in
// future artefact modules.
export const ALLOWED_HIDDEN_FILES = new Set(['.env.example']);

export function assertSafeDeckSlug(slug: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(slug)) {
    throw new Error('Invalid deck slug');
  }
  return slug;
}

export function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return;
  throw new Error('Path escapes Open-Slide root');
}

export function assertNoSymlinkSegments(root: string, relPath: string): void {
  let current = root;
  for (const part of relPath.split('/')) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('Deck path symlinks are not editable');
    }
  }
}

export function cleanDeckPath(path: string): string {
  const raw = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw.includes('\0') || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new Error('Deck path contains invalid bytes');
  }
  if (raw.includes('../') || raw === '..' || raw.startsWith('..')) {
    throw new Error('Path traversal is not allowed');
  }
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('Path traversal is not allowed');
    if (BLOCKED_SEGMENTS.has(part)) throw new Error(`Deck path segment "${part}" is not editable`);
    parts.push(part);
  }
  return parts.join('/');
}
