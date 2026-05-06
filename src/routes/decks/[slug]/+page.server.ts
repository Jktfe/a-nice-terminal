// /decks/[slug] — minimal deck file editor.
//
// Why a server-side load + form action instead of browser-side fetches to
// /api/decks/...? The deck API (`requireDeckCaller`) needs either an admin
// master key or a per-room bearer token — neither is reachable from a
// same-origin browser without scope-creeping into auth. We therefore
// consume the same `decks.ts` primitives directly here and preserve the
// `{ if_match_mtime, base_hash, actor }` write-guard contract so a 409 from
// `writeDeckBytes` flows back to the page exactly the way the API would
// surface it. See feedback note in the page summary.

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  DeckConflictError,
  listDeckFiles,
  readDeckAudit,
  readDeckBytes,
  readDeckManifest,
  readDeckMeta,
  writeDeckBytes,
  type DeckAuditEvent,
  type DeckFileEntry,
  type DeckMeta,
} from '$lib/server/decks';

const TEXT_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonc',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.svelte',
  '.svg',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
]);

const TEXT_MAX_BYTES = 512 * 1024; // 512 KB safety net for the textarea editor

function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTS.has(path.slice(dot).toLowerCase());
}

function summariseDeck(deck: DeckMeta) {
  return {
    slug: deck.slug,
    title: deck.title,
    deck_dir: deck.deck_dir,
    owner_session_id: deck.owner_session_id,
    allowed_room_ids: deck.allowed_room_ids,
    dev_port: deck.dev_port,
    created_at: deck.created_at,
    updated_at: deck.updated_at,
  };
}

function summariseFiles(files: DeckFileEntry[]): DeckFileEntry[] {
  return files.filter((entry) => entry.kind === 'file');
}

function recentAudit(events: DeckAuditEvent[]): DeckAuditEvent[] {
  return events.slice(-25).reverse();
}

export const load: PageServerLoad = async ({ params }) => {
  const slug = String(params.slug ?? '');
  if (!slug) throw error(400, 'deck slug required');
  const deck = readDeckMeta(slug);
  if (!deck) throw error(404, `deck "${slug}" not found`);
  return {
    deck: summariseDeck(deck),
    files: summariseFiles(listDeckFiles(deck)),
    manifest: readDeckManifest(deck),
    audit: recentAudit(readDeckAudit(deck, 50)),
  };
};

interface OpenedFile {
  path: string;
  size: number;
  mtime_ms: number;
  sha256: string;
  is_text: boolean;
  content: string | null;
}

function openFileByPath(deck: DeckMeta, path: string): OpenedFile {
  const file = readDeckBytes(deck, path);
  const isText = isTextPath(file.path) && file.bytes.byteLength <= TEXT_MAX_BYTES;
  return {
    path: file.path,
    size: file.size,
    mtime_ms: file.mtime_ms,
    sha256: file.sha256,
    is_text: isText,
    content: isText ? file.bytes.toString('utf8') : null,
  };
}

export const actions: Actions = {
  // Open a file for editing. Returns the same payload an API GET would carry
  // (path, mtime_ms, sha256) so the page knows the base hash for the next save.
  open: async ({ request, params }) => {
    const slug = String(params.slug ?? '');
    const deck = readDeckMeta(slug);
    if (!deck) return fail(404, { open_error: `deck "${slug}" not found` });
    const data = await request.formData();
    const path = String(data.get('path') || '');
    if (!path) return fail(400, { open_error: 'path required' });
    try {
      const opened = openFileByPath(deck, path);
      return { opened };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(400, { open_error: message, open_path: path });
    }
  },

  // Save edits. Mirrors the API's write-guard contract: the caller passes
  // base_hash + if_match_mtime, the server runs assertWriteGuard, and on
  // conflict surfaces DeckConflictError.details (path, expected/actual hash,
  // expected/actual mtime, exists) plus a fresh snapshot of the current file.
  save: async ({ request, params }) => {
    const slug = String(params.slug ?? '');
    const deck = readDeckMeta(slug);
    if (!deck) return fail(404, { save_error: `deck "${slug}" not found` });
    const data = await request.formData();
    const path = String(data.get('path') || '');
    const content = String(data.get('content') ?? '');
    const baseHash = (data.get('base_hash') ? String(data.get('base_hash')) : '').toLowerCase() || null;
    const rawMtime = data.get('if_match_mtime');
    const ifMatchMtime = rawMtime != null && rawMtime !== '' ? Number(rawMtime) : null;
    const actor = String(data.get('actor') || 'web');
    if (!path) return fail(400, { save_error: 'path required', save_path: path });

    try {
      const written = writeDeckBytes(deck, path, Buffer.from(content, 'utf8'), {
        base_hash: baseHash,
        if_match_mtime: Number.isFinite(ifMatchMtime) ? ifMatchMtime : null,
        actor,
      });
      // Re-read the saved file so the editor gets the new mtime + sha to use
      // as the next base for incremental edits without a round-trip.
      const opened = openFileByPath(deck, written.path);
      return {
        saved: {
          path: written.path,
          size: written.size,
          mtime_ms: written.mtime_ms,
          sha256: written.sha256,
        },
        opened,
        audit: recentAudit(readDeckAudit(deck, 50)),
      };
    } catch (err) {
      if (err instanceof DeckConflictError) {
        // Re-fetch the current file so the page can render side-by-side
        // without an extra round-trip. The conflict details from the
        // backend already carry the metadata (expected vs actual hash +
        // mtime); the file bytes are what's missing from the contract.
        let current: OpenedFile | null = null;
        try {
          current = openFileByPath(deck, path);
        } catch {
          current = null;
        }
        return fail(409, {
          conflict: {
            message: err.message,
            details: err.details,
            current,
            attempted_content: content,
            attempted_base_hash: baseHash,
            attempted_if_match_mtime: ifMatchMtime,
            path,
            actor,
          },
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      return fail(400, { save_error: message, save_path: path });
    }
  },
};
