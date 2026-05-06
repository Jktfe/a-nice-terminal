import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { queries } from './db.js';
import {
  ALLOWED_HIDDEN_FILES,
  BLOCKED_SEGMENTS,
  assertInside,
  assertNoSymlinkSegments,
  assertSafeDeckSlug,
  cleanDeckPath,
} from './artefact-fs.js';

const DEFAULT_OPEN_SLIDE_DIR = join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

// Re-export the path-safety helpers so existing import sites keep working.
// Wave 2 (sheets, docs) should import directly from artefact-fs.ts.
export { assertSafeDeckSlug };

export interface DeckMeta {
  slug: string;
  title: string;
  deck_dir: string;
  owner_session_id: string;
  allowed_room_ids: string[];
  dev_port: number | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface DeckFileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime_ms: number;
}

export interface RegisterDeckInput {
  slug: string;
  owner_session_id?: string;
  allowed_room_ids?: string[];
  deck_dir?: string | null;
  dev_port?: number | null;
}

export function openSlideRoot(): string {
  return process.env.ANT_OPEN_SLIDE_DIR || DEFAULT_OPEN_SLIDE_DIR;
}

export function deckMaxFileBytes(): number {
  const raw = Number(process.env.ANT_DECK_MAX_FILE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_FILE_BYTES;
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function defaultDeckDirForSlug(slug: string): string {
  const safe = assertSafeDeckSlug(slug);
  const root = resolve(openSlideRoot());
  const deckDir = resolve(root, safe);
  assertInside(root, deckDir);
  return deckDir;
}

function normaliseDeckDir(input: string | null | undefined, slug: string): string {
  const root = resolve(openSlideRoot());
  const deckDir = resolve(input || defaultDeckDirForSlug(slug));
  assertInside(root, deckDir);
  return deckDir;
}

export function parseRoomIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parseRoomIds(parsed);
  } catch {
    return [];
  }
}

function roomSet(ownerSessionId: string, roomIds: string[] | undefined): string[] {
  const rooms = new Set<string>();
  rooms.add(ownerSessionId);
  for (const id of roomIds ?? []) {
    if (typeof id === 'string' && id.trim()) rooms.add(id.trim());
  }
  return Array.from(rooms);
}

function rowToDeck(row: any): DeckMeta {
  const slug = String(row.slug);
  const ownerSessionId = typeof row.owner_session_id === 'string' ? row.owner_session_id : '';
  return {
    slug,
    title: titleFromSlug(slug),
    deck_dir: String(row.deck_dir),
    owner_session_id: ownerSessionId,
    allowed_room_ids: roomSet(ownerSessionId, parseRoomIds(row.allowed_room_ids)),
    dev_port: typeof row.dev_port === 'number' ? row.dev_port : row.dev_port == null ? null : Number(row.dev_port),
    created_at: typeof row.created_at === 'number' ? row.created_at : Number(row.created_at) || null,
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : Number(row.updated_at) || null,
  };
}

export function readDeckMeta(slug: string): DeckMeta | null {
  const safe = assertSafeDeckSlug(slug);
  const row = queries.getDeck(safe);
  if (!row) return null;
  return rowToDeck(row);
}

export function registerDeck(input: RegisterDeckInput): DeckMeta {
  const slug = assertSafeDeckSlug(input.slug);
  const previous = readDeckMeta(slug);
  const ownerSessionId = input.owner_session_id ?? previous?.owner_session_id;
  if (!ownerSessionId) throw new Error('Deck owner_session_id required');
  const allowedRoomIds = roomSet(ownerSessionId, input.allowed_room_ids ?? previous?.allowed_room_ids ?? []);
  const deckDir = normaliseDeckDir(input.deck_dir ?? previous?.deck_dir, slug);
  mkdirSync(deckDir, { recursive: true });

  queries.upsertDeck({
    slug,
    owner_session_id: ownerSessionId,
    allowed_room_ids: JSON.stringify(allowedRoomIds),
    deck_dir: deckDir,
    dev_port: input.dev_port ?? previous?.dev_port ?? null,
    now_ms: Date.now(),
  });

  const deck = readDeckMeta(slug);
  if (!deck) throw new Error('Failed to register deck');
  return deck;
}

export function listDecks(): DeckMeta[] {
  return (queries.listDecks() as any[]).map(rowToDeck);
}

export function resolveDeckFile(deck: DeckMeta, path: string): { relPath: string; absPath: string } {
  const relPath = cleanDeckPath(path);
  if (!relPath) throw new Error('Deck file path required');
  const absPath = resolve(deck.deck_dir, relPath);
  assertInside(deck.deck_dir, absPath);
  assertNoSymlinkSegments(deck.deck_dir, relPath);
  return { relPath, absPath };
}

export function listDeckFiles(deck: DeckMeta): DeckFileEntry[] {
  if (!existsSync(deck.deck_dir)) throw new Error('Deck not found');
  const rows: DeckFileEntry[] = [];

  function walk(dir: string, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (BLOCKED_SEGMENTS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && !ALLOWED_HIDDEN_FILES.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = statSync(abs);
      if (entry.isDirectory()) {
        rows.push({ path: rel, kind: 'dir', size: 0, mtime_ms: stat.mtimeMs });
        walk(abs, rel);
      } else if (entry.isFile()) {
        rows.push({ path: rel, kind: 'file', size: stat.size, mtime_ms: stat.mtimeMs });
      }
    }
  }

  walk(deck.deck_dir);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function readDeckTextFile(deck: DeckMeta, path: string): { path: string; content: string; size: number; updated_at: string } {
  const resolved = resolveDeckFile(deck, path);
  const stat = statSync(resolved.absPath);
  if (!stat.isFile()) throw new Error('Deck path is not a file');
  if (stat.size > deckMaxFileBytes()) throw new Error('Deck file exceeds max size');
  return {
    path: resolved.relPath,
    content: readFileSync(resolved.absPath, 'utf8'),
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
  };
}

export function readDeckBytes(deck: DeckMeta, path: string): { path: string; bytes: Buffer; size: number; mtime_ms: number } {
  const resolved = resolveDeckFile(deck, path);
  const stat = statSync(resolved.absPath);
  if (!stat.isFile()) throw new Error('Deck path is not a file');
  if (stat.size > deckMaxFileBytes()) throw new Error('Deck file exceeds max size');
  return {
    path: resolved.relPath,
    bytes: readFileSync(resolved.absPath),
    size: stat.size,
    mtime_ms: stat.mtimeMs,
  };
}

export function writeDeckBytes(deck: DeckMeta, path: string, bytes: Buffer | Uint8Array): { path: string; size: number; mtime_ms: number } {
  if (bytes.byteLength > deckMaxFileBytes()) throw new Error('Deck file exceeds max size');
  const resolved = resolveDeckFile(deck, path);
  mkdirSync(dirname(resolved.absPath), { recursive: true });
  writeFileSync(resolved.absPath, bytes);
  const stat = statSync(resolved.absPath);
  return { path: resolved.relPath, size: stat.size, mtime_ms: stat.mtimeMs };
}

export function writeDeckTextFile(deck: DeckMeta, path: string, content: string): { path: string; size: number; updated_at: string } {
  const resolved = resolveDeckFile(deck, path);
  mkdirSync(dirname(resolved.absPath), { recursive: true });
  writeFileSync(resolved.absPath, content, 'utf8');
  const stat = statSync(resolved.absPath);
  return { path: resolved.relPath, size: stat.size, updated_at: stat.mtime.toISOString() };
}

export function deleteDeckPath(deck: DeckMeta, path: string): { path: string } {
  const resolved = resolveDeckFile(deck, path);
  const stat = statSync(resolved.absPath);
  if (stat.isDirectory()) throw new Error('Deleting directories is not supported');
  rmSync(resolved.absPath, { recursive: true, force: true });
  return { path: resolved.relPath };
}
